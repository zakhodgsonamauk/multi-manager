import type { DatabaseSync } from 'node:sqlite';
import { buildStopCommand } from '../launch/command.ts';
import { findSessionPid } from '../launch/process.ts';
import { runCommand, type RunResult } from '../launch/runner.ts';
import { releaseAll } from '../roster/claims.ts';
import { iso, many, one, tx } from '../roster/db.ts';
import { raiseItem } from '../roster/items.ts';
import { listLimits } from '../roster/limits.ts';
import { frontDesk, getSession, setClaudeSessionId, setSessionPid, type Session } from '../roster/sessions.ts';
import { realActivityReaders, type ActivityReaders } from './activity.ts';
import { planEnforcement, type Enforcement, type MonitoredSession } from './enforce.ts';
import { detectStuck, type StuckReport } from './health.ts';
import { snapshotProcesses, type ProcessInfo } from './processes.ts';

export const DEFAULT_INTERVAL_MS = 30_000;

/** Everything the monitor does to the outside world; tests pass fakes. */
export interface MonitorDeps {
  snapshot: () => Promise<ProcessInfo[]>;
  /** Kills a process and its whole tree (taskkill /PID <pid> /T /F). */
  kill: (pid: number) => Promise<RunResult>;
  now?: () => Date;
  /** This process; it and its ancestors are never killed. */
  selfPid?: number;
  log?: (message: string) => void;
  /** Loop gate: ticks do nothing (not even a snapshot) while this returns false. */
  active?: () => boolean;
  /** Claude Code session files and transcripts, for stuck detection. Without it, stuck detection is skipped. */
  activity?: ActivityReaders;
  /**
   * The newest Claude Code session file naming this session, with its cwd inside `within`, whose pid passes isLive
   * (findSessionPid's rules). Used to pick up sessions whose launch gave up waiting for the process. Without it,
   * they stay pid-less.
   */
  findSessionPid?: (name: string, isLive: (pid: number) => boolean, within: string) => number | null;
}

export function realMonitorDeps(): MonitorDeps {
  return {
    snapshot: snapshotProcesses,
    kill: (pid) => runCommand(buildStopCommand(pid)),
    selfPid: process.pid,
    activity: realActivityReaders(),
    findSessionPid: (name, isLive, within) => findSessionPid(name, { isLive, within }),
    log: (message) => process.stderr.write(`[multi-manager monitor] ${message}\n`),
  };
}

const MONITOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS monitor_identity (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id),
  pid INTEGER NOT NULL,
  created REAL
);
CREATE TABLE IF NOT EXISTS monitor_deaths (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  pid INTEGER NOT NULL,
  item_id INTEGER,
  at TEXT NOT NULL,
  UNIQUE (session_id, pid)
);
CREATE TABLE IF NOT EXISTS monitor_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL
);`;

const ready = new WeakSet<DatabaseSync>();

function ensureMonitorSchema(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(MONITOR_SCHEMA);
  ready.add(db);
}

interface RunningRow {
  id: number;
  role: string;
  parent_id: number | null;
  project_id: number | null;
  name: string | null;
  root_pid: number | null;
}

/** wrapper_pid is added by the launcher work; prefer it when the column exists. */
function hasWrapperPid(db: DatabaseSync): boolean {
  return many<{ name: string }>(db.prepare('PRAGMA table_info(sessions)').all()).some((c) => c.name === 'wrapper_pid');
}

/** Running architects and developers with a known process id. The front desk is never monitored. */
export function monitoredSessions(db: DatabaseSync): MonitoredSession[] {
  const root = hasWrapperPid(db) ? 'COALESCE(wrapper_pid, pid)' : 'pid';
  const rows = many<RunningRow>(
    db
      .prepare(
        `SELECT id, role, parent_id, project_id, name, ${root} AS root_pid FROM sessions
         WHERE state = 'running' AND role <> 'front-desk' AND ${root} IS NOT NULL ORDER BY id`,
      )
      .all(),
  );
  return rows.map((r) => ({ ...r, root_pid: r.root_pid as number }));
}

export interface Death {
  session_id: number;
  name: string | null;
  role: string;
  pid: number;
  reason: 'gone' | 'pid-reused';
  item_id: number;
}

function addresseeFor(db: DatabaseSync, session: MonitoredSession, now: Date): number {
  if (session.role === 'architect' || session.parent_id === null) return frontDesk(db, now).id;
  const parent = getSession(db, session.parent_id);
  return parent !== undefined && parent.state === 'running' ? parent.id : frontDesk(db, now).id;
}

/**
 * Marks running sessions whose process is gone (or whose pid now belongs to a newer process) as stopped
 * and raises one `blocked` item per death. Safe against concurrent monitors: each death is recorded once.
 */
export function detectDeaths(db: DatabaseSync, snapshot: readonly ProcessInfo[], now: Date = new Date()): Death[] {
  ensureMonitorSchema(db);
  const byPid = new Map(snapshot.map((p) => [p.pid, p]));
  const deaths: Death[] = [];
  for (const session of monitoredSessions(db)) {
    const proc = byPid.get(session.root_pid);
    let reason: Death['reason'] | null = proc === undefined ? 'gone' : null;
    if (proc !== undefined) {
      const known = one<{ pid: number; created: number | null }>(
        db.prepare('SELECT pid, created FROM monitor_identity WHERE session_id = ?').get(session.id),
      );
      const created = Number.isNaN(proc.created) ? null : proc.created;
      if (known === undefined || known.pid !== proc.pid) {
        db.prepare(
          'INSERT INTO monitor_identity (session_id, pid, created) VALUES (?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET pid = excluded.pid, created = excluded.created',
        ).run(session.id, proc.pid, created);
      } else if (known.created !== null && created !== null && known.created !== created) {
        reason = 'pid-reused';
      }
    }
    if (reason === null) continue;
    const death = tx(db, (): Death | null => {
      // Re-read: the session may have been stopped on purpose since the snapshot was taken.
      const fresh = monitoredSessions(db).find((s) => s.id === session.id);
      if (fresh === undefined || fresh.root_pid !== session.root_pid) return null;
      const inserted = db
        .prepare('INSERT OR IGNORE INTO monitor_deaths (session_id, pid, at) VALUES (?, ?, ?)')
        .run(session.id, session.root_pid, iso(now));
      if (inserted.changes === 0) return null;
      db.prepare("UPDATE sessions SET state = 'stopped' WHERE id = ? AND state = 'running'").run(session.id);
      const released = releaseAll(db, session.id);
      const who = `${session.role} session #${session.id}${session.name === null ? '' : ` (${session.name})`}`;
      const why = reason === 'gone' ? `its process ${session.root_pid} is gone` : `its process id ${session.root_pid} now belongs to another program`;
      const claims = released > 0 ? ` Released its ${released} claim(s).` : '';
      const item = raiseItem(
        db,
        {
          kind: 'blocked',
          body: `Monitor: ${who} died unexpectedly: ${why}. Marked it stopped.${claims} Relaunch it if its work is unfinished.`,
          raisedBy: session.id,
          addressedTo: addresseeFor(db, session, now),
        },
        now,
      );
      db.prepare('UPDATE monitor_deaths SET item_id = ? WHERE session_id = ? AND pid = ?').run(item.id, session.id, session.root_pid);
      return { session_id: session.id, name: session.name, role: session.role, pid: session.root_pid, reason, item_id: item.id };
    });
    if (death !== null) deaths.push(death);
  }
  return deaths;
}

/**
 * Fills in (or follows a change of) each running session's Claude Code conversation id from its session file,
 * so a crash or reboot can `claude --resume` it. A file naming a different session (pid reuse) is ignored.
 */
export function refreshConversationIds(db: DatabaseSync, readers: ActivityReaders): number {
  const running = many<Session>(db.prepare("SELECT * FROM sessions WHERE state = 'running' AND role <> 'front-desk' AND pid IS NOT NULL").all());
  let updated = 0;
  for (const session of running) {
    const file = readers.readSessionFile(session.pid as number);
    if (file === null || typeof file !== 'object') continue;
    const { sessionId, name } = file as Record<string, unknown>;
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId === session.claude_session_id) continue;
    if (typeof name === 'string' && session.name !== null && name !== session.name) continue;
    setClaudeSessionId(db, session.id, sessionId);
    updated += 1;
  }
  return updated;
}

/**
 * Records the claude.exe pid of each running architect or developer that has none (its launch gave up waiting,
 * e.g. behind Claude Code's "trust this folder?" prompt), so death detection and the conversation-id refresh
 * cover it. Only a live claude.exe whose session file names the session and whose cwd is inside the session's
 * folder counts (another cluster can have a tab of the same name), and never a pid another running session holds.
 */
export function adoptLatePids(
  db: DatabaseSync,
  snapshot: readonly ProcessInfo[],
  find: (name: string, isLive: (pid: number) => boolean, within: string) => number | null,
): number {
  const claude = new Set(snapshot.filter((p) => p.name.toLowerCase() === 'claude.exe').map((p) => p.pid));
  // A developer's worktree lives under its project folder, so the project folder covers both roles.
  const pidless = many<{ id: number; name: string; folder: string }>(
    db
      .prepare(
        `SELECT s.id, s.name, COALESCE(s.folder, p.folder) AS folder FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.state = 'running' AND s.role <> 'front-desk' AND s.pid IS NULL AND s.name IS NOT NULL
           AND COALESCE(s.folder, p.folder) IS NOT NULL ORDER BY s.id`,
      )
      .all(),
  );
  let adopted = 0;
  for (const session of pidless) {
    const pid = find(session.name, (p) => claude.has(p), session.folder);
    if (pid === null) continue;
    const taken = one(db.prepare("SELECT id FROM sessions WHERE state = 'running' AND pid = ? AND id <> ?").get(pid, session.id));
    if (taken !== undefined) continue;
    setSessionPid(db, session.id, pid);
    adopted += 1;
  }
  return adopted;
}

/** The pid and every ancestor of it: the monitor must never kill its own host. */
export function ancestry(snapshot: readonly ProcessInfo[], pid: number | undefined): Set<number> {
  const result = new Set<number>();
  if (pid === undefined) return result;
  const byPid = new Map(snapshot.map((p) => [p.pid, p]));
  let current = byPid.get(pid);
  result.add(pid);
  while (current !== undefined && !result.has(current.ppid)) {
    const parent = byPid.get(current.ppid);
    if (parent === undefined || (!Number.isNaN(parent.created) && !Number.isNaN(current.created) && parent.created > current.created)) break;
    result.add(parent.pid);
    current = parent;
  }
  return result;
}

export interface KillOutcome {
  pid: number;
  name: string;
  ok: boolean;
  detail: string;
}

export interface EnforcementOutcome extends Enforcement {
  outcomes: KillOutcome[];
  item_id: number;
}

export interface TickResult {
  at: string;
  sessions_checked: number;
  deaths: Death[];
  enforcements: EnforcementOutcome[];
  /** Sessions that newly looked stuck this pass (one blocked item each). */
  stuck: StuckReport[];
  errors: string[];
}

async function enforce(db: DatabaseSync, deps: MonitorDeps, snapshot: readonly ProcessInfo[], now: Date): Promise<EnforcementOutcome[]> {
  const plan = planEnforcement(snapshot, monitoredSessions(db), listLimits(db), { protectedPids: ancestry(snapshot, deps.selfPid) });
  const results: EnforcementOutcome[] = [];
  for (const enforcement of plan) {
    const outcomes: KillOutcome[] = [];
    for (const kill of enforcement.kills) {
      const result = await deps.kill(kill.pid);
      outcomes.push({ pid: kill.pid, name: kill.name, ok: result.code === 0, detail: result.code === 0 ? 'killed' : `taskkill exit ${result.code}: ${(result.stderr || result.stdout).trim()}` });
    }
    const failed = outcomes.filter((o) => !o.ok);
    const failures = failed.length === 0 ? '' : ` Kill failed for: ${failed.map((o) => `${o.name} ${o.pid} (${o.detail})`).join('; ')}.`;
    const target: MonitoredSession = {
      id: enforcement.session_id,
      role: getSession(db, enforcement.session_id)?.role ?? 'developer',
      parent_id: enforcement.parent_id,
      project_id: enforcement.project_id,
      name: enforcement.session_name,
      root_pid: 0,
    };
    const item = raiseItem(
      db,
      { kind: 'info', body: `Monitor enforced a limit: ${enforcement.reason}${failures}`, raisedBy: enforcement.session_id, addressedTo: addresseeFor(db, target, now) },
      now,
    );
    results.push({ ...enforcement, outcomes, item_id: item.id });
  }
  return results;
}

let chain: Promise<unknown> = Promise.resolve();

/** One monitor pass: late pid pickup, death detection, enforcement, then stuck detection. Passes in this process never overlap. */
export function runTick(db: DatabaseSync, deps: MonitorDeps): Promise<TickResult> {
  const next = chain.then(async (): Promise<TickResult> => {
    const now = deps.now?.() ?? new Date();
    const result: TickResult = { at: iso(now), sessions_checked: 0, deaths: [], enforcements: [], stuck: [], errors: [] };
    let snapshot: ProcessInfo[];
    try {
      snapshot = await deps.snapshot();
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      return result;
    }
    if (snapshot.length === 0) {
      result.errors.push('Empty process snapshot; skipped this pass rather than report every session dead.');
      return result;
    }
    try {
      if (deps.findSessionPid !== undefined) adoptLatePids(db, snapshot, deps.findSessionPid);
      result.sessions_checked = monitoredSessions(db).length;
      result.deaths = detectDeaths(db, snapshot, now);
      result.enforcements = await enforce(db, deps, snapshot, now);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
    if (deps.activity !== undefined) {
      try {
        refreshConversationIds(db, deps.activity);
        result.stuck = detectStuck(db, deps.activity, now);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return result;
  });
  chain = next.catch(() => undefined);
  return next;
}

/** Takes or renews the single monitor lease, so two front-desk servers never both act. */
export function acquireLease(db: DatabaseSync, owner: string, now: Date, ttlMs: number): boolean {
  ensureMonitorSchema(db);
  return tx(db, () => {
    const lease = one<{ owner: string; expires_at: string }>(db.prepare('SELECT owner, expires_at FROM monitor_lease WHERE id = 1').get());
    if (lease !== undefined && lease.owner !== owner && Date.parse(lease.expires_at) > now.getTime()) return false;
    db.prepare(
      'INSERT INTO monitor_lease (id, owner, expires_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at',
    ).run(owner, iso(new Date(now.getTime() + ttlMs)));
    return true;
  });
}

export interface MonitorHandle {
  /** One gated pass now (skipped while inactive or while another server holds the lease). */
  tick: () => Promise<TickResult | null>;
  stop: () => void;
}

/** Runs a monitor pass every intervalMs while deps.active() holds. The timer never keeps the process alive. */
export function startMonitor(db: DatabaseSync, deps: MonitorDeps, intervalMs: number = DEFAULT_INTERVAL_MS): MonitorHandle {
  const owner = `pid-${deps.selfPid ?? process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const tick = async (): Promise<TickResult | null> => {
    if (deps.active !== undefined && !deps.active()) return null;
    const now = deps.now?.() ?? new Date();
    if (!acquireLease(db, owner, now, intervalMs * 3)) return null;
    const result = await runTick(db, deps);
    for (const error of result.errors) deps.log?.(error);
    for (const death of result.deaths) deps.log?.(`session #${death.session_id} died (${death.reason}); item #${death.item_id}`);
    for (const e of result.enforcements) deps.log?.(`enforced: ${e.reason}`);
    for (const s of result.stuck) deps.log?.(`session #${s.session_id} looks ${s.state}, quiet ${s.minutes_quiet} min; item #${s.item_id}`);
    return result;
  };
  const timer = setInterval(() => {
    tick().catch((error: unknown) => deps.log?.(error instanceof Error ? error.message : String(error)));
  }, intervalMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
