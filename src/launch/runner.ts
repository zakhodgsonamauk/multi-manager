import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Command, SettingsFile } from './command.ts';
import {
  claudeSessionsDir,
  findSessionPid,
  parseProcessInfo,
  parseTasklistImage,
  parseTasklistPids,
  readSessionFile,
  sessionFileName,
} from './process.ts';
import { ensureTerminalProfile } from './terminal-profile.ts';
import { isWrapperProcess } from './wrapper.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (command: Command) => Promise<RunResult>;

/** Everything the launcher does to the outside world; tests pass fakes. */
export interface LaunchDeps {
  run: Runner;
  writeSettings: (file: SettingsFile) => void;
  /** claude.exe pid from its session file, skipping stale files of dead processes. */
  waitForPid: (name: string, since: number) => Promise<number | null>;
  findPid: (name: string) => Promise<number | null>;
  ownsProcess: (pid: number, name: string) => Promise<boolean>;
  /** The wrapper's own pid from <id>.wrapper.pid: waited for after launch, read once on stop. */
  waitForWrapperPid: (path: string) => Promise<number | null>;
  readWrapperPid: (path: string) => number | null;
  /** True only for a live pwsh.exe running this session's wrapper script (see isWrapperProcess). */
  ownsWrapper: (pid: number, marker: string) => Promise<boolean>;
  /** Deletes our own state files; missing ones are fine. */
  removeFiles: (paths: string[]) => void;
  ensureTerminalProfile: () => void;
}

/**
 * The environment for anything we start. Drops the calling session's Claude Code variables: a tab that
 * inherits CLAUDE_CODE_CHILD_SESSION (and friends) never registers for cross-session messaging (spike step 3).
 */
export function launchEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$)/.test(key) || key === 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'),
  );
}

/** wt.exe must not get windowsHide: it hides the new Terminal window too (spike step 2). */
export function hidesWindow(file: string): boolean {
  return !/(^|[\\/])wt(\.exe)?$/i.test(file);
}

export const runCommand: Runner = (command) =>
  new Promise((resolve) => {
    const options = { timeout: 60_000, windowsHide: hidesWindow(command.file), env: launchEnv(), encoding: 'utf8' as const };
    execFile(command.file, command.args, options, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stdout, stderr: stderr !== '' ? stderr : (error?.message ?? '') });
    });
  });

export function writeSettingsFile(file: SettingsFile): void {
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, file.content);
}

export function removeFiles(paths: string[]): void {
  for (const path of paths) rmSync(path, { force: true });
}

export interface WaitOptions {
  dir?: string;
  timeoutMs?: number;
  intervalMs?: number;
  /** Pids that may be returned; defaults to every running claude.exe. */
  livePids?: () => Promise<Set<number>>;
}

/** Pids of every running claude.exe (one tasklist call). */
export async function claudePids(): Promise<Set<number>> {
  const result = await runCommand({ file: 'tasklist', args: ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH'] });
  return parseTasklistPids(result.stdout);
}

export async function findLivePid(name: string, options: WaitOptions & { since?: number } = {}): Promise<number | null> {
  const live = await (options.livePids ?? claudePids)();
  return findSessionPid(name, { since: options.since, dir: options.dir, isLive: (pid) => live.has(pid) });
}

export async function waitForPid(name: string, since: number, options: WaitOptions = {}): Promise<number | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const pid = await findLivePid(name, { ...options, since });
    if (pid !== null) return pid;
    if (Date.now() >= deadline) return null;
    await delay(options.intervalMs ?? 500);
  }
}

export function readPidFile(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function waitForPidFile(path: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<number | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const pid = readPidFile(path);
    if (pid !== null) return pid;
    if (Date.now() >= deadline) return null;
    await delay(options.intervalMs ?? 250);
  }
}

/** Image name and command line of a live process, or null. */
export async function processInfo(pid: number): Promise<{ name: string; commandLine: string } | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const query = `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object Name, CommandLine | ConvertTo-Json -Compress`;
  const result = await runCommand({ file: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', query] });
  return result.code === 0 ? parseProcessInfo(result.stdout) : null;
}

/** True only if pid is a live pwsh.exe whose -EncodedCommand script carries this session's marker line. */
export async function ownsWrapper(pid: number, marker: string): Promise<boolean> {
  return isWrapperProcess(await processInfo(pid), marker);
}

/** True only if <pid>.json names this session and the live process is claude.exe. Guards against pid reuse. */
export async function ownsProcess(pid: number, name: string, dir: string = claudeSessionsDir()): Promise<boolean> {
  const file = readSessionFile(pid, dir);
  if (file === null || sessionFileName(file) !== name) return false;
  const result = await runCommand({ file: 'tasklist', args: ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'] });
  return parseTasklistImage(result.stdout)?.toLowerCase() === 'claude.exe';
}

export function realDeps(): LaunchDeps {
  return {
    run: runCommand,
    writeSettings: writeSettingsFile,
    waitForPid: (name, since) => waitForPid(name, since),
    findPid: (name) => findLivePid(name),
    ownsProcess: (pid, name) => ownsProcess(pid, name),
    waitForWrapperPid: (path) => waitForPidFile(path),
    readWrapperPid: readPidFile,
    ownsWrapper,
    removeFiles,
    ensureTerminalProfile: () => {
      ensureTerminalProfile();
    },
  };
}
