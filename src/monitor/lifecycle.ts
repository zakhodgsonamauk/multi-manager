import type { DatabaseSync } from 'node:sqlite';
import { buildStopCommand, FRESH_AFTER_IDLE_STOP, FRESH_AFTER_REFRESH } from '../launch/command.ts';
import { restartArchitect, stopSession, type LaunchContext } from '../launch/launcher.ts';
import { sessionFiles, sessionStateDir, wrapperMarker } from '../launch/wrapper.ts';
import { many, one, resolveDbPath } from '../roster/db.ts';
import { raiseItem } from '../roster/items.ts';
import { assertNotPaused, isPaused } from '../roster/pause.ts';
import { requireProjectById } from '../roster/projects.ts';
import { frontDesk, requireSession, runningChildren, setClaudeSessionId, type Session } from '../roster/sessions.ts';
import { readActivity, type ActivityReaders, type ClaudeStatus } from './activity.ts';

/**
 * Keeps the big, long-lived managers (architects and project managers) cheap:
 *  - refresh: an idle manager whose conversation grew past the project's context_limit_tokens writes its resume
 *    note (the front desk asks it to), then is restarted with a fresh conversation that resumes from that note;
 *  - idle stop: a manager idle past idle_stop_minutes with nothing running under it and nothing waiting for it
 *    is stopped, and brought back from its notes when an item is addressed to it.
 * Its developers keep running through a refresh. Quiet time is the session's OWN quiet time: a timer
 * check-in turn does not count (see transcript.ts).
 */

/** The manager must have been quiet this long before it is asked to write its note. */
export const NOTE_QUIET_MS = 5 * 60_000;
/** After it says the note is written, it must be idle this long before the restart. */
export const RESTART_QUIET_MS = 60_000;
/** A resume-note request nobody answered within this long is dropped (the digest goes quiet; a new one can follow). */
export const REFRESH_REQUEST_TTL_MS = 30 * 60_000;
/** A note older than this, with the session active since, is stale: ask again. */
export const NOTE_STALE_MS = 3 * 60_000;
/** After a request expired unanswered, nobody asks again for this long (the digest stays quiet meanwhile). */
export const REFRESH_COOLDOWN_MS = 2 * 60 * 60_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS manager_lifecycle (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id),
  refresh_requested_at INTEGER,
  note_ready_at INTEGER,
  idle_stopped_at INTEGER,
  idle_stopped_pid INTEGER,
  refresh_expired_at INTEGER
);`;
const ready = new WeakSet<DatabaseSync>();
function ensure(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  // A roster made before the cool-down existed lacks the column.
  const columns = many<{ name: string }>(db.prepare('PRAGMA table_info(manager_lifecycle)').all());
  if (!columns.some((c) => c.name === 'refresh_expired_at')) {
    try {
      db.exec('ALTER TABLE manager_lifecycle ADD COLUMN refresh_expired_at INTEGER');
    } catch (error) {
      // Each manager has its own roster server: another one may have added the column a moment ago.
      if (!/duplicate column/i.test(message(error))) throw error;
    }
  }
  ready.add(db);
}

export interface LifecycleRow {
  session_id: number;
  refresh_requested_at: number | null;
  note_ready_at: number | null;
  idle_stopped_at: number | null;
  /** The claude pid it had when the idle stop killed it: a relaunch (any other restart) has a different one. */
  idle_stopped_pid: number | null;
  /** When a resume-note request expired unanswered: no new request until the cool-down has passed. */
  refresh_expired_at: number | null;
}

export function lifecycleRow(db: DatabaseSync, sessionId: number): LifecycleRow | undefined {
  ensure(db);
  return one<LifecycleRow>(db.prepare('SELECT * FROM manager_lifecycle WHERE session_id = ?').get(sessionId));
}

function setColumns(db: DatabaseSync, sessionId: number, values: Partial<Omit<LifecycleRow, 'session_id'>>): void {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO manager_lifecycle (session_id) VALUES (?)').run(sessionId);
  for (const [column, value] of Object.entries(values)) {
    db.prepare(`UPDATE manager_lifecycle SET ${column} = ? WHERE session_id = ?`).run(value, sessionId);
  }
}

export function clearLifecycle(db: DatabaseSync, sessionId: number): void {
  ensure(db);
  db.prepare('DELETE FROM manager_lifecycle WHERE session_id = ?').run(sessionId);
}

/** The manager says its resume note is written. Returns false if no refresh was asked for. */
export function markNoteReady(db: DatabaseSync, sessionId: number, now: number): boolean {
  const row = lifecycleRow(db, sessionId);
  if (row === undefined || row.refresh_requested_at === null) return false;
  setColumns(db, sessionId, { note_ready_at: now });
  return true;
}

/**
 * Something is waiting for a manager: any open item addressed to it (a developer's done report under review is
 * one) or an answered item it has not read. One definition for refresh, idle stop and bring-back, so they never
 * disagree (an information item keeps a manager alive until it clears itself).
 */
export function pendingItemCount(db: DatabaseSync, sessionId: number): number {
  const row = one<{ n: number }>(
    db.prepare("SELECT COUNT(*) AS n FROM items WHERE addressed_to = ? AND (state = 'open' OR (state = 'answered' AND seen = 0))").get(sessionId),
  );
  return row?.n ?? 0;
}

export type RefreshDecision = 'none' | 'request-note' | 'restart';

export interface RefreshInput {
  /** Latest call's input + cache read + cache write tokens; null when unknown. */
  contextTokens: number | null;
  limitTokens: number;
  status: ClaudeStatus;
  /** How long since the session last did something itself. */
  ownQuietMs: number;
  /** pendingItemCount: an unread answer, or work under review. */
  pendingItems: number;
  noteRequested: boolean;
  noteReady: boolean;
  paused: boolean;
}

/** Pure. Below the limit, busy, paused or with something pending: never. Otherwise ask for the note, then restart. */
export function decideRefresh(input: RefreshInput): RefreshDecision {
  if (input.paused || input.contextTokens === null || input.contextTokens <= input.limitTokens) return 'none';
  if (input.status !== 'idle' || input.pendingItems > 0) return 'none';
  if (input.noteReady) return input.ownQuietMs >= RESTART_QUIET_MS ? 'restart' : 'none';
  if (input.noteRequested) return 'none';
  return input.ownQuietMs >= NOTE_QUIET_MS ? 'request-note' : 'none';
}

export interface IdleStopInput {
  status: ClaudeStatus;
  ownQuietMinutes: number;
  idleStopMinutes: number;
  /** Developers (of an architect) or architects (of a project manager) still running under it. */
  runningChildren: number;
  pendingItems: number;
  paused: boolean;
}

/** Pure. A waiting goal does not keep a manager alive; running work under it and items for it do. */
export function decideIdleStop(input: IdleStopInput): boolean {
  if (input.paused || input.status !== 'idle') return false;
  if (input.runningChildren > 0 || input.pendingItems > 0) return false;
  return input.ownQuietMinutes > input.idleStopMinutes;
}

/**
 * The process to kill for this running session, only if it is provably its own (same rules as the launcher's
 * stop): its wrapper, else its claude.exe. Null when it cannot be proven: then nothing is killed or restarted.
 */
async function ownedProcess(ctx: LaunchContext, session: Session): Promise<number | null> {
  const files = sessionFiles(sessionStateDir(resolveDbPath(ctx.env)), session.id);
  const wrapperPid = session.wrapper_pid ?? ctx.deps.readWrapperPid(files.wrapperPid);
  if (wrapperPid !== null && (await ctx.deps.ownsWrapper(wrapperPid, wrapperMarker(session.id, resolveDbPath(ctx.env))))) return wrapperPid;
  if (session.pid === null || session.name === null) return null;
  return (await ctx.deps.ownsProcess(session.pid, session.name)) ? session.pid : null;
}

/**
 * Starts a manager over with a fresh conversation. A running old process is killed here first, and only if it is
 * provably this session's and the kill worked (otherwise a second copy would open next to a live one). Its saved
 * conversation id is dropped just before the relaunch so nothing is resumed, and put back if the relaunch fails.
 */
async function replaceWithFresh(ctx: LaunchContext, session: Session, reason: string): Promise<void> {
  const label = session.name ?? `session #${session.id}`;
  if (session.state === 'running') {
    const target = await ownedProcess(ctx, session);
    if (target === null) throw new Error(`${label}: could not prove the running process is its own, so it was left alone`);
    const result = await ctx.deps.run(buildStopCommand(target));
    if (result.code !== 0 && !isProcessGone(result)) throw new Error(`${label}: killing process ${target} failed (taskkill exit ${result.code}), so no second copy was opened`);
  }
  assertNotPaused(ctx.db, session.project_id);
  const saved = requireSession(ctx.db, session.id).claude_session_id;
  setClaudeSessionId(ctx.db, session.id, null);
  try {
    await restartArchitect(ctx, { sessionId: session.id, reason });
  } catch (error) {
    setClaudeSessionId(ctx.db, session.id, saved);
    throw error;
  }
}

export interface LifecycleReport {
  idle_stopped: { session_id: number; name: string; quiet_minutes: number }[];
  note_requested: { session_id: number; name: string; context_tokens: number }[];
  refreshed: { session_id: number; name: string; context_tokens: number }[];
  restored: { session_id: number; name: string }[];
  errors: string[];
}

function rosterMs(s: Session): number {
  const at = Date.parse(s.last_checkin_at ?? s.created_at);
  return Number.isFinite(at) ? at : 0;
}

/** taskkill says the process is not there (it exited by itself since we proved it ours): that is stopped, not a failed kill. */
export function isProcessGone(result: { stderr: string; stdout: string }): boolean {
  return /not found|no running instance/i.test(`${result.stderr} ${result.stdout}`);
}

const label = (s: Session): string => s.name ?? `session #${s.id}`;
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** True while a resume-note request is still live (asked less than the TTL ago, note not yet written). */
export function refreshRequestLive(row: LifecycleRow | undefined, nowMs: number): boolean {
  return row?.refresh_requested_at != null && row.note_ready_at == null && nowMs - row.refresh_requested_at <= REFRESH_REQUEST_TTL_MS;
}

/** One pass over every architect and project manager. Needs the launch context to stop and restart them. */
export async function runLifecycle(ctx: LaunchContext, readers: ActivityReaders, now: Date): Promise<LifecycleReport> {
  const { db } = ctx;
  ensure(db);
  const report: LifecycleReport = { idle_stopped: [], note_requested: [], refreshed: [], restored: [], errors: [] };
  const t = now.getTime();
  // An idle-stop mark only means something while that same stopped session is still stopped. Running again (a manual
  // restart, or a pause and resume), or a different pid (it was relaunched and stopped some other way), drops it.
  for (const row of many<LifecycleRow>(db.prepare('SELECT * FROM manager_lifecycle WHERE idle_stopped_at IS NOT NULL').all())) {
    const s = one<{ state: string; pid: number | null }>(db.prepare('SELECT state, pid FROM sessions WHERE id = ?').get(row.session_id));
    if (s === undefined || s.state === 'running' || s.pid !== row.idle_stopped_pid) clearLifecycle(db, row.session_id);
  }
  const stoppedNow = new Set<number>();
  const running = many<Session>(
    db.prepare("SELECT * FROM sessions WHERE state = 'running' AND role IN ('architect', 'project-manager') AND pid IS NOT NULL AND project_id IS NOT NULL AND workstream_id IS NOT NULL ORDER BY id").all(),
  );
  for (const session of running) {
    try {
      const project = requireProjectById(db, session.project_id as number);
      const paused = isPaused(db, project.id);
      const activity = readActivity(session.pid, rosterMs(session), readers);
      const own = activity.own_activity_ms ?? activity.last_activity_ms;
      const ownQuietMs = Math.max(0, t - own);
      const pendingItems = pendingItemCount(db, session.id);
      if (
        decideIdleStop({
          status: activity.status,
          ownQuietMinutes: Math.floor(ownQuietMs / 60_000),
          idleStopMinutes: project.idle_stop_minutes,
          runningChildren: runningChildren(db, session.id).length,
          pendingItems,
          paused,
        })
      ) {
        // Only a process that is provably its own is killed, and the kill comes first: a failed kill leaves the manager
        // exactly as it was (settings files, tool connection and claims intact). Only after a good kill does
        // stopSession clean up.
        const target = await ownedProcess(ctx, session);
        if (target === null) {
          report.errors.push(`${label(session)}: idle, but could not prove the running process is its own, so it was not stopped`);
          continue;
        }
        const kill = await ctx.deps.run(buildStopCommand(target));
        if (kill.code !== 0 && !isProcessGone(kill)) {
          report.errors.push(`${label(session)}: idle stop failed to kill the process (taskkill exit ${kill.code}: ${kill.stderr || kill.stdout || 'no detail'}); left running`);
          continue;
        }
        await stopSession(ctx, session.id);
        clearLifecycle(db, session.id);
        setColumns(db, session.id, { idle_stopped_at: t, idle_stopped_pid: session.pid });
        stoppedNow.add(session.id);
        report.idle_stopped.push({ session_id: session.id, name: label(session), quiet_minutes: Math.floor(ownQuietMs / 60_000) });
        continue;
      }
      let row = lifecycleRow(db, session.id);
      // A note followed by real work is stale: start over. A request nobody answered in time, or one the session no
      // longer needs (its conversation is back under the limit), is dropped so the digest goes quiet.
      const staleNote = row?.note_ready_at != null && own > row.note_ready_at + NOTE_STALE_MS;
      const expired = row?.refresh_requested_at != null && row.note_ready_at == null && !refreshRequestLive(row, t);
      const small = row?.refresh_requested_at != null && activity.context_tokens !== null && activity.context_tokens <= project.context_limit_tokens;
      if (staleNote || small) {
        clearLifecycle(db, session.id);
        row = undefined;
      } else if (expired) {
        // Dropped, but remembered: no new request until the cool-down has passed.
        setColumns(db, session.id, { refresh_requested_at: null, note_ready_at: null, refresh_expired_at: t });
        row = lifecycleRow(db, session.id);
      }
      const decision = decideRefresh({
        contextTokens: activity.context_tokens,
        limitTokens: project.context_limit_tokens,
        status: activity.status,
        ownQuietMs,
        pendingItems,
        noteRequested: row?.refresh_requested_at != null,
        noteReady: row?.note_ready_at != null,
        paused,
      });
      const coolingDown = row?.refresh_expired_at != null && t - row.refresh_expired_at < REFRESH_COOLDOWN_MS;
      if (decision === 'request-note' && coolingDown) continue;
      if (decision === 'request-note') {
        setColumns(db, session.id, { refresh_requested_at: t, refresh_expired_at: null });
        report.note_requested.push({ session_id: session.id, name: label(session), context_tokens: activity.context_tokens as number });
      } else if (decision === 'restart') {
        await replaceWithFresh(ctx, session, FRESH_AFTER_REFRESH);
        clearLifecycle(db, session.id);
        report.refreshed.push({ session_id: session.id, name: label(session), context_tokens: activity.context_tokens as number });
      }
    } catch (error) {
      report.errors.push(`${label(session)}: ${message(error)}`);
    }
  }
  await restoreIdleStopped(ctx, now, report, stoppedNow);
  return report;
}

/**
 * A manager the idle stop stopped comes back, fresh and from its notes, once something is waiting for it. Only
 * those: a manager stopped any other way stays stopped. Never in the pass that stopped it, never while paused.
 */
async function restoreIdleStopped(ctx: LaunchContext, now: Date, report: LifecycleReport, stoppedNow: ReadonlySet<number>): Promise<void> {
  const { db } = ctx;
  const stopped = many<Session>(
    db
      .prepare(
        `SELECT s.* FROM sessions s JOIN manager_lifecycle l ON l.session_id = s.id
         WHERE s.state = 'stopped' AND s.role IN ('architect', 'project-manager') AND l.idle_stopped_at IS NOT NULL
           AND s.pid IS l.idle_stopped_pid AND s.project_id IS NOT NULL AND s.workstream_id IS NOT NULL ORDER BY s.id`,
      )
      .all(),
  );
  for (const session of stopped) {
    if (stoppedNow.has(session.id) || isPaused(db, session.project_id)) continue;
    if (pendingItemCount(db, session.id) === 0) continue;
    // Whatever happens next, the stop mark goes: a failed bring-back is reported once, not retried every pass.
    clearLifecycle(db, session.id);
    try {
      await replaceWithFresh(ctx, session, FRESH_AFTER_IDLE_STOP);
      report.restored.push({ session_id: session.id, name: label(session) });
    } catch (error) {
      report.errors.push(`${label(session)}: ${message(error)}`);
      raiseItem(
        db,
        { kind: 'blocked', body: `${label(session)} was stopped while idle and an item is waiting for it, but bringing it back failed: ${message(error)}`, raisedBy: session.id, addressedTo: frontDesk(db, now).id },
        now,
      );
    }
  }
}
