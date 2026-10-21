import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The fields we rely on in Claude Code's ~/.claude/sessions/<pid>.json (verified 2026-10-21; see spike.md). */
export interface ClaudeSessionFile {
  pid: number;
  name?: string;
  startedAt?: number;
  kind?: string;
  cwd?: string;
}

/** The session-file field that holds the `claude -n` name. The only place to change if the spike finds a different field. */
export function sessionFileName(file: ClaudeSessionFile): string | undefined {
  return file.name;
}

export function claudeSessionsDir(): string {
  return join(homedir(), '.claude', 'sessions');
}

export function readSessionFile(pid: number, dir: string = claudeSessionsDir()): ClaudeSessionFile | null {
  try {
    return JSON.parse(readFileSync(join(dir, `${pid}.json`), 'utf8')) as ClaudeSessionFile;
  } catch {
    return null;
  }
}

/**
 * The newest session file named `name`. Claude Code leaves stale files behind after a kill (spike step 7),
 * so callers pass `isLive` (e.g. "is a running claude.exe") to skip entries whose process is gone.
 */
export function findSessionPid(
  name: string,
  options: { since?: number; dir?: string; isLive?: (pid: number) => boolean } = {},
): number | null {
  const dir = options.dir ?? claudeSessionsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let best: ClaudeSessionFile | null = null;
  for (const entry of entries) {
    if (!/^\d+\.json$/.test(entry)) continue;
    let file: ClaudeSessionFile;
    try {
      file = JSON.parse(readFileSync(join(dir, entry), 'utf8')) as ClaudeSessionFile;
    } catch {
      continue;
    }
    if (sessionFileName(file) !== name || typeof file.pid !== 'number') continue;
    if (options.isLive !== undefined && !options.isLive(file.pid)) continue;
    const started = file.startedAt ?? 0;
    if (options.since !== undefined && started < options.since) continue;
    if (best === null || started > (best.startedAt ?? 0)) best = file;
  }
  return best === null ? null : best.pid;
}

/** `tasklist /FI "PID eq N" /FO CSV /NH` → "claude.exe","N",… or an INFO line when nothing matches. */
export function parseTasklistImage(csv: string): string | null {
  const match = /^"([^"]+)","(\d+)"/m.exec(csv.trim());
  return match === null ? null : match[1];
}

/** Every pid in `tasklist /FI "IMAGENAME eq <image>" /FO CSV /NH` output. */
export function parseTasklistPids(csv: string): Set<number> {
  const pids = new Set<number>();
  for (const match of csv.matchAll(/^"[^"]+","(\d+)"/gm)) pids.add(Number(match[1]));
  return pids;
}

/** `Get-CimInstance Win32_Process … | ConvertTo-Json` → name and command line, or null. */
export function parseProcessInfo(json: string): { name: string; commandLine: string } | null {
  try {
    const value = JSON.parse(json) as { Name?: unknown; CommandLine?: unknown } | null;
    if (value === null || typeof value.Name !== 'string') return null;
    return { name: value.Name, commandLine: typeof value.CommandLine === 'string' ? value.CommandLine : '' };
  } catch {
    return null;
  }
}
