import { childIndex, sessionTree, type ChildIndex, type ProcessInfo } from './processes.ts';

/** A running roster session whose process we can find. root_pid is wrapper_pid when known, else pid. */
export interface MonitoredSession {
  id: number;
  role: string;
  parent_id: number | null;
  project_id: number | null;
  name: string | null;
  root_pid: number;
}

export type BinaryCaps = Record<string, number>;

export interface Limits {
  project_id: number;
  max_processes_per_session: number | null;
  session_binary_caps: BinaryCaps;
  machine_binary_caps: BinaryCaps;
}

export type Rule = 'max_processes_per_session' | 'session_binary_cap' | 'machine_binary_cap';

export interface KillAction {
  pid: number;
  name: string;
  created: number;
  /** Everything under pid that taskkill /T takes down with it. */
  subtree: { pid: number; name: string }[];
}

export interface Enforcement {
  session_id: number;
  session_name: string | null;
  parent_id: number | null;
  project_id: number | null;
  rule: Rule;
  binary: string | null;
  count: number;
  cap: number;
  kills: KillAction[];
  reason: string;
}

/** Case-insensitive; "godot" matches godot.exe; "*" is a wildcard ("godot*.exe"). */
export function matchesBinary(name: string, pattern: string): boolean {
  const n = name.toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (p.includes('*')) {
    const regex = new RegExp(`^${p.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return regex.test(n) || (!p.endsWith('.exe') && regex.test(n.replace(/\.exe$/, '')));
  }
  return n === p || n === `${p}.exe`;
}

export interface Ownership {
  /** Sessions whose root process is alive in the snapshot. */
  alive: MonitoredSession[];
  /** Session id → processes in its tree (root excluded; nested sessions' trees excluded). */
  trees: Map<number, ProcessInfo[]>;
  index: ChildIndex;
  roots: Set<number>;
}

export function ownership(snapshot: readonly ProcessInfo[], sessions: readonly MonitoredSession[]): Ownership {
  const pids = new Set(snapshot.map((p) => p.pid));
  const seenRoots = new Set<number>();
  const alive = sessions.filter((s) => {
    if (!pids.has(s.root_pid) || seenRoots.has(s.root_pid)) return false;
    seenRoots.add(s.root_pid);
    return true;
  });
  const roots = new Set(alive.map((s) => s.root_pid));
  const index = childIndex(snapshot);
  const trees = new Map<number, ProcessInfo[]>();
  for (const session of alive) trees.set(session.id, sessionTree(snapshot, session.root_pid, { stopAt: roots, index }));
  return { alive, trees, index, roots };
}

function newestFirst(a: ProcessInfo, b: ProcessInfo): number {
  const ca = Number.isNaN(a.created) ? -Infinity : a.created;
  const cb = Number.isNaN(b.created) ? -Infinity : b.created;
  return cb - ca || b.pid - a.pid;
}

function describeKills(kills: readonly KillAction[]): string {
  return kills
    .map((k) => {
      const extra = k.subtree.length === 0 ? '' : ` with ${k.subtree.length} child process(es): ${k.subtree.map((c) => `${c.name} ${c.pid}`).join(', ')}`;
      return `${k.name} (pid ${k.pid})${extra}`;
    })
    .join('; ');
}

function label(session: MonitoredSession): string {
  return `session #${session.id}${session.name === null ? '' : ` (${session.name})`}`;
}

export interface PlanOptions {
  /** Pids that must never be killed, nor any process whose subtree contains them (e.g. this monitor). */
  protectedPids?: ReadonlySet<number>;
}

/**
 * Pure: what to kill so every cap holds. Only processes inside the trees of the given (running, roster
 * registered) sessions are candidates, never a session's root. Excess is removed newest first, each kill
 * taking its whole subtree.
 */
export function planEnforcement(
  snapshot: readonly ProcessInfo[],
  sessions: readonly MonitoredSession[],
  limits: readonly Limits[],
  options: PlanOptions = {},
): Enforcement[] {
  const own = ownership(snapshot, sessions);
  const killed = new Set<number>();
  const protectedPids = options.protectedPids ?? new Set<number>();
  const limitsFor = new Map(limits.map((l) => [l.project_id, l]));
  const result: Enforcement[] = [];

  const live = (sessionId: number): ProcessInfo[] => (own.trees.get(sessionId) ?? []).filter((p) => !killed.has(p.pid));

  /** Plans one kill; returns the processes it takes down, or null if the candidate is untouchable. */
  const kill = (session: MonitoredSession, target: ProcessInfo): { action: KillAction; gone: ProcessInfo[] } | null => {
    const inTree = new Set(live(session.id).map((p) => p.pid));
    if (!inTree.has(target.pid) || protectedPids.has(target.pid)) return null;
    // taskkill /T takes everything below, so anything below that is not ours (another session's root,
    // a protected pid) makes the target untouchable.
    const below = sessionTree(snapshot, target.pid, { index: own.index }).filter((p) => !killed.has(p.pid));
    if (below.some((p) => protectedPids.has(p.pid) || own.roots.has(p.pid) || !inTree.has(p.pid))) return null;
    for (const p of [target, ...below]) killed.add(p.pid);
    return {
      action: { pid: target.pid, name: target.name, created: target.created, subtree: below.map((p) => ({ pid: p.pid, name: p.name })) },
      gone: [target, ...below],
    };
  };

  /** Kills newest matching processes in one session until `excess` matches are gone. */
  const trim = (session: MonitoredSession, match: (p: ProcessInfo) => boolean, excess: number): KillAction[] => {
    const actions: KillAction[] = [];
    let remaining = excess;
    for (const candidate of live(session.id).filter(match).sort(newestFirst)) {
      if (remaining <= 0) break;
      if (killed.has(candidate.pid)) continue;
      const done = kill(session, candidate);
      if (done === null) continue;
      actions.push(done.action);
      remaining -= done.gone.filter(match).length;
    }
    return actions;
  };

  const push = (session: MonitoredSession, rule: Rule, binary: string | null, count: number, cap: number, kills: KillAction[]): void => {
    if (kills.length === 0) return;
    const what = binary === null ? 'processes' : `${binary} processes`;
    const scope = rule === 'machine_binary_cap' ? 'across all Multi-Manager sessions' : `in ${label(session)}`;
    result.push({
      session_id: session.id,
      session_name: session.name,
      parent_id: session.parent_id,
      project_id: session.project_id,
      rule,
      binary,
      count,
      cap,
      kills,
      reason: `${count} ${what} ${scope}, cap ${cap}. Killed in ${label(session)}: ${describeKills(kills)}.`,
    });
  };

  for (const session of own.alive) {
    const lim = session.project_id === null ? undefined : limitsFor.get(session.project_id);
    if (lim === undefined) continue;
    for (const [binary, cap] of Object.entries(lim.session_binary_caps)) {
      const match = (p: ProcessInfo): boolean => matchesBinary(p.name, binary);
      const count = live(session.id).filter(match).length;
      if (count > cap) push(session, 'session_binary_cap', binary, count, cap, trim(session, match, count - cap));
    }
    if (lim.max_processes_per_session !== null) {
      const count = live(session.id).length;
      const cap = lim.max_processes_per_session;
      if (count > cap) push(session, 'max_processes_per_session', null, count, cap, trim(session, () => true, count - cap));
    }
  }

  for (const lim of limits) {
    for (const [binary, cap] of Object.entries(lim.machine_binary_caps)) {
      const match = (p: ProcessInfo): boolean => matchesBinary(p.name, binary);
      const total = own.alive.reduce((sum, s) => sum + live(s.id).filter(match).length, 0);
      if (total <= cap) continue;
      let excess = total - cap;
      const owners = new Map(own.alive.filter((s) => s.project_id === lim.project_id).map((s) => [s.id, s]));
      const candidates = [...owners.values()]
        .flatMap((s) => live(s.id).filter(match).map((p) => ({ session: s, proc: p })))
        .sort((a, b) => newestFirst(a.proc, b.proc));
      const bySession = new Map<number, KillAction[]>();
      for (const { session, proc } of candidates) {
        if (excess <= 0) break;
        if (killed.has(proc.pid)) continue;
        const done = kill(session, proc);
        if (done === null) continue;
        bySession.set(session.id, [...(bySession.get(session.id) ?? []), done.action]);
        excess -= done.gone.filter(match).length;
      }
      for (const [sessionId, kills] of bySession) push(owners.get(sessionId) as MonitoredSession, 'machine_binary_cap', binary, total, cap, kills);
    }
  }
  return result;
}

export interface BinaryUsage {
  binary: string;
  count: number;
  session_cap: number | null;
  machine_cap: number | null;
  machine_count: number;
  over: boolean;
}

export interface SessionResources {
  session_id: number;
  name: string | null;
  role: string;
  project_id: number | null;
  root_pid: number;
  alive: boolean;
  process_count: number;
  max_processes: number | null;
  over_max: boolean;
  binaries: BinaryUsage[];
  top_binaries: { name: string; count: number }[];
}

/** Pure: per-session usage against the caps of its project. */
export function resourceReport(
  snapshot: readonly ProcessInfo[],
  sessions: readonly MonitoredSession[],
  limits: readonly Limits[],
): SessionResources[] {
  const own = ownership(snapshot, sessions);
  const aliveIds = new Set(own.alive.map((s) => s.id));
  const limitsFor = new Map(limits.map((l) => [l.project_id, l]));
  const all = [...own.trees.values()].flat();
  return sessions.map((session) => {
    const tree = own.trees.get(session.id) ?? [];
    const lim = session.project_id === null ? undefined : limitsFor.get(session.project_id);
    const names = new Set([...Object.keys(lim?.session_binary_caps ?? {}), ...Object.keys(lim?.machine_binary_caps ?? {})]);
    const binaries = [...names].sort().map((binary): BinaryUsage => {
      const count = tree.filter((p) => matchesBinary(p.name, binary)).length;
      const machineCount = all.filter((p) => matchesBinary(p.name, binary)).length;
      const sessionCap = lim?.session_binary_caps[binary] ?? null;
      const machineCap = lim?.machine_binary_caps[binary] ?? null;
      return {
        binary,
        count,
        session_cap: sessionCap,
        machine_cap: machineCap,
        machine_count: machineCount,
        over: (sessionCap !== null && count > sessionCap) || (machineCap !== null && machineCount > machineCap),
      };
    });
    const counts = new Map<string, number>();
    for (const p of tree) counts.set(p.name.toLowerCase(), (counts.get(p.name.toLowerCase()) ?? 0) + 1);
    const max = lim?.max_processes_per_session ?? null;
    return {
      session_id: session.id,
      name: session.name,
      role: session.role,
      project_id: session.project_id,
      root_pid: session.root_pid,
      alive: aliveIds.has(session.id),
      process_count: tree.length,
      max_processes: max,
      over_max: max !== null && tree.length > max,
      binaries,
      top_binaries: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8),
    };
  });
}
