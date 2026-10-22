import { execFile } from 'node:child_process';

/** One row of a Windows process snapshot. `created` is milliseconds since the epoch (NaN if unknown). */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  created: number;
  commandLine: string | null;
}

export const SNAPSHOT_SCRIPT =
  'Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name,CreationDate,CommandLine | ConvertTo-Json -Compress';

/** Windows PowerShell 5.1 writes "\/Date(ms)\/"; PowerShell 7 writes an ISO string. */
export function parseCreationDate(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value !== null && typeof value === 'object' && 'value' in value) return parseCreationDate((value as { value: unknown }).value);
  if (typeof value !== 'string') return Number.NaN;
  const legacy = /\/Date\((-?\d+)[^)]*\)\//.exec(value);
  if (legacy !== null) return Number(legacy[1]);
  return Date.parse(value);
}

interface RawProcess {
  ProcessId?: unknown;
  ParentProcessId?: unknown;
  Name?: unknown;
  CreationDate?: unknown;
  CommandLine?: unknown;
}

/** Parses ConvertTo-Json output (an array, or a bare object when there is one process). */
export function parseSnapshot(json: string): ProcessInfo[] {
  const trimmed = json.trim();
  if (trimmed === '') return [];
  // Windows PowerShell 5.1 leaves some control characters raw inside strings (seen: U+001A from a code-page
  // conversion in another program's command line), and one such process would fail the whole snapshot.
  // Compressed output has no raw control characters between tokens, so escaping them all is safe.
  // eslint-disable-next-line no-control-regex
  const escaped = trimmed.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const parsed = JSON.parse(escaped) as RawProcess | RawProcess[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.flatMap((row) => {
    const pid = Number(row.ProcessId);
    if (!Number.isInteger(pid)) return [];
    return [
      {
        pid,
        ppid: Number.isInteger(Number(row.ParentProcessId)) ? Number(row.ParentProcessId) : 0,
        name: typeof row.Name === 'string' ? row.Name : '',
        created: parseCreationDate(row.CreationDate),
        commandLine: typeof row.CommandLine === 'string' ? row.CommandLine : null,
      },
    ];
  });
}

/** A live snapshot of every process on the machine. Read-only: it never touches a process. */
export function snapshotProcesses(): Promise<ProcessInfo[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', SNAPSHOT_SCRIPT],
      { windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`Process snapshot failed: ${stderr !== '' ? stderr : error.message}`));
          return;
        }
        try {
          resolve(parseSnapshot(stdout));
        } catch (parseError) {
          reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
        }
      },
    );
  });
}

export type ChildIndex = Map<number, ProcessInfo[]>;

export function childIndex(snapshot: readonly ProcessInfo[]): ChildIndex {
  const index: ChildIndex = new Map();
  for (const proc of snapshot) {
    if (proc.pid === proc.ppid) continue; // System Idle Process is its own parent
    const list = index.get(proc.ppid);
    if (list === undefined) index.set(proc.ppid, [proc]);
    else list.push(proc);
  }
  return index;
}

/**
 * A real child was created no earlier than its parent. A process whose recorded parent pid now belongs to a
 * newer process is an orphan of a dead parent (pid reuse), not a child of the newcomer.
 */
export function isChildOf(child: ProcessInfo, parent: ProcessInfo): boolean {
  if (child.ppid !== parent.pid || child.pid === parent.pid) return false;
  if (Number.isNaN(child.created) || Number.isNaN(parent.created)) return true;
  return child.created >= parent.created;
}

/**
 * Every descendant of rootPid (the root itself excluded), parents before children.
 * `stopAt` pids (other sessions' roots) and everything under them are left out.
 */
export function sessionTree(
  snapshot: readonly ProcessInfo[],
  rootPid: number,
  options: { stopAt?: ReadonlySet<number>; index?: ChildIndex } = {},
): ProcessInfo[] {
  const root = snapshot.find((p) => p.pid === rootPid);
  if (root === undefined) return [];
  const index = options.index ?? childIndex(snapshot);
  const result: ProcessInfo[] = [];
  const seen = new Set<number>([root.pid]);
  const queue: ProcessInfo[] = [root];
  while (queue.length > 0) {
    const parent = queue.shift() as ProcessInfo;
    for (const child of index.get(parent.pid) ?? []) {
      if (seen.has(child.pid) || !isChildOf(child, parent)) continue;
      seen.add(child.pid);
      if (options.stopAt?.has(child.pid) === true) continue;
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}
