import { dirname, join, win32 } from 'node:path';

/**
 * The PowerShell wrapper every session tab runs (field report: kill-on-close Jobs everywhere).
 * It joins a kill-on-close Job, so anything the session starts dies with the tab; strips the
 * inherited Claude Code variables; records its own pid; runs claude; and records the exit.
 */
export interface WrapperSpec {
  sessionId: number;
  rosterDb: string;
  /** Where <id>.wrapper.pid and <id>.exit go: <roster dir>/sessions. */
  stateDir: string;
  folder: string;
  /** Arguments after `claude`. */
  claudeArgs: string[];
  /** The program to run; `claude` unless a test swaps in something harmless. */
  program?: string;
  /** Optional JOB_OBJECT_LIMIT_ACTIVE_PROCESS cap (the wrapper itself counts). */
  maxProcesses?: number;
}

export interface SessionFiles {
  settings: string;
  wrapperPid: string;
  exit: string;
}

export function sessionStateDir(rosterDb: string): string {
  return join(dirname(rosterDb), 'sessions');
}

export function sessionFiles(stateDir: string, sessionId: number): SessionFiles {
  return {
    settings: join(stateDir, `${sessionId}.settings.json`),
    wrapperPid: join(stateDir, `${sessionId}.wrapper.pid`),
    exit: join(stateDir, `${sessionId}.exit`),
  };
}

/** First line of every wrapper script; proves a pwsh process is this roster's wrapper for this session. */
export function wrapperMarker(sessionId: number, rosterDb: string): string {
  // win32.resolve normalises slashes; lower-casing makes drive letters and folders compare the way Windows does,
  // so the marker written at launch matches the one checked at stop.
  const roster = win32.resolve(rosterDb).toLowerCase().replace(/[\r\n]/g, ' ');
  return `# multi-manager wrapper session=${sessionId} roster=${roster}`;
}

/** A PowerShell single-quoted literal. */
export function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** C# for the kill-on-close Job (after conflict-command tools/job.ps1). Returns "" on success, else why not. */
const JOB_TYPE = `
using System;
using System.Runtime.InteropServices;
public static class MmKillOnCloseJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long A; public long B; public uint Flags; public UIntPtr MinWs; public UIntPtr MaxWs; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority; public uint Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Ext { public Basic B; public ulong R1, W1, O1, R2, W2, O2; public UIntPtr Pm, Jm, Ppm, Pjm; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref Ext i, uint l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  // Never closed: Windows closes it when this process ends, and that close kills every process in the Job.
  public static IntPtr Job = IntPtr.Zero;
  public static string Enable(uint maxProcesses) {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return "CreateJobObject failed (" + Marshal.GetLastWin32Error() + ")";
    Ext info = new Ext();
    info.B.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (maxProcesses > 0) { info.B.Flags |= 0x8; info.B.ActiveProcessLimit = maxProcesses; } // JOB_OBJECT_LIMIT_ACTIVE_PROCESS
    if (!SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(Ext))) || !AssignProcessToJobObject(job, GetCurrentProcess())) {
      int err = Marshal.GetLastWin32Error();
      CloseHandle(job);
      return "could not join a kill-on-close Job (" + err + ")";
    }
    Job = job;
    return "";
  }
}`;

/** Joins a kill-on-close Job; on failure warns and carries on (the session still runs). */
export function jobSnippet(maxProcesses?: number): string {
  const cap = maxProcesses ?? 0;
  if (!Number.isInteger(cap) || cap < 0) throw new Error(`Invalid process cap ${maxProcesses}`);
  return [
    `if (-not ('MmKillOnCloseJob' -as [type])) { Add-Type -TypeDefinition @'${JOB_TYPE}\n'@ }`,
    `$mmWhy = [MmKillOnCloseJob]::Enable(${cap})`,
    `if ($mmWhy) { Write-Warning "multi-manager: $mmWhy; processes this session starts can outlive its tab" }`,
  ].join('\n');
}

export function buildWrapperScript(spec: WrapperSpec): string {
  const files = sessionFiles(spec.stateDir, spec.sessionId);
  const program = spec.program === undefined ? 'claude' : psQuote(spec.program);
  const claude = [program, ...spec.claudeArgs.map(psQuote)].join(' ');
  return [
    wrapperMarker(spec.sessionId, spec.rosterDb),
    `$ErrorActionPreference = 'Continue'`,
    // Windows Terminal re-hosts the tab, so the launcher never learns this pid: record it ourselves.
    `[IO.Directory]::CreateDirectory(${psQuote(spec.stateDir)}) | Out-Null`,
    `[IO.File]::WriteAllText(${psQuote(files.wrapperPid)}, "$PID")`,
    jobSnippet(spec.maxProcesses),
    // A tab that inherits the calling session's variables never registers for messaging (spike step 3).
    `Get-ChildItem env: | Where-Object { $_.Name -eq 'CLAUDECODE' -or $_.Name -eq 'CLAUDE_PID' -or ($_.Name -like 'CLAUDE_CODE_*' -and $_.Name -ne 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS') } | ForEach-Object { Remove-Item -LiteralPath "env:$($_.Name)" }`,
    `Set-Location -LiteralPath ${psQuote(spec.folder)}`,
    `& ${claude}`,
    `$mmCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }`,
    `[IO.File]::WriteAllText(${psQuote(files.exit)}, (ConvertTo-Json -Compress @{ code = $mmCode; at = (Get-Date).ToUniversalTime().ToString('o') }))`,
    `exit $mmCode`,
    '',
  ].join('\n');
}

/** pwsh -EncodedCommand takes base64 of UTF-16LE; it survives paths with spaces and parentheses. */
export function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function decodeCommand(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

export const PWSH_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'] as const;

/** True only for a pwsh.exe whose -EncodedCommand script starts with this session's marker line. */
export function isWrapperProcess(info: { name: string; commandLine: string } | null, marker: string): boolean {
  if (info === null || info.name.toLowerCase() !== 'pwsh.exe') return false;
  const match = /\s-EncodedCommand\s+"?([A-Za-z0-9+/=]+)"?/i.exec(info.commandLine);
  if (match === null) return false;
  const script = decodeCommand(match[1]);
  return script.split('\n', 1)[0] === marker;
}
