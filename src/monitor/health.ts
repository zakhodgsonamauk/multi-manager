import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from '../roster/db.ts';
import { raiseItem } from '../roster/items.ts';
import { getStallMinutes } from '../roster/limits.ts';
import { isPaused } from '../roster/pause.ts';
import { frontDesk, getSession, type Session } from '../roster/sessions.ts';
import { readActivity, type ActivityReaders, type ClaudeStatus } from './activity.ts';

/**
 * Stuck detection. A running session is `hung` (busy, quiet for stall_minutes), `stalled` (idle with
 * unfinished work, quiet for stall_minutes), `dead` (its process is gone; the monitor's death detection
 * marked it) or `ok`. The ladder is nudge, nudge, then restart (developers) or report to the user
 * (architects, never restarted automatically).
 */
export type HealthState = 'ok' | 'hung' | 'stalled' | 'dead';
export type HealthAction = 'none' | 'nudge' | 'restart' | 'report';
export type HealthRole = 'architect' | 'developer';

export const MAX_NUDGES = 2;
/**
 * A nudge wakes the session, so it writes to its transcript at once. Only activity more than this long after
 * a nudge (or after a stuck report) counts as the session getting going again; a quick "ok" reply does not
 * reset the ladder.
 */
export const ACTIVITY_GRACE_MS = 5 * 60_000;

export const RESTART_LINE = 'You were restarted after stalling. Check your branch and worktree for earlier work before starting again.';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS health_nudges (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id),
  count INTEGER NOT NULL,
  last_nudge_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS health_episodes (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id),
  reported_at INTEGER NOT NULL,
  item_id INTEGER
);`;

const ready = new WeakSet<DatabaseSync>();

function ensure(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  ready.add(db);
}

export interface NudgeRecord {
  count: number;
  /** ms since the epoch */
  last_nudge_at: number;
}

/** Nudges since the session's last real activity: activity newer than the last nudge (plus grace) resets the count. */
export function effectiveNudges(record: NudgeRecord | null | undefined, lastActivityMs: number): number {
  if (record === null || record === undefined) return 0;
  return lastActivityMs > record.last_nudge_at + ACTIVITY_GRACE_MS ? 0 : record.count;
}

export interface HealthInput {
  role: HealthRole;
  /** false when the process is gone. */
  alive: boolean;
  status: ClaudeStatus;
  lastActivityMs: number;
  /** Developer: no done item raised since launch. Architect: goals in planning or in progress. */
  unfinished: boolean;
  stallMinutes: number;
  nudge: NudgeRecord | null | undefined;
  /** The session's project (or everything) is paused: report, but recommend nothing. */
  paused?: boolean;
  now: number;
}

export interface HealthAssessment {
  state: HealthState;
  minutes_quiet: number;
  nudges: number;
  recommended_action: HealthAction;
  reason: string;
}

/** Pure: the health state and the next rung of the ladder. A busy session with recent activity is never stuck. */
export function assessHealth(input: HealthInput): HealthAssessment {
  const quietMs = Math.max(0, input.now - input.lastActivityMs);
  const minutes_quiet = Math.floor(quietMs / 60_000);
  const nudges = effectiveNudges(input.nudge, input.lastActivityMs);
  const escalate: HealthAction = input.role === 'developer' ? 'restart' : 'report';
  const result = (state: HealthState, reason: string, action: HealthAction): HealthAssessment => {
    if (input.paused === true && action !== 'none') return { state, minutes_quiet, nudges, recommended_action: 'none', reason: `${reason} (paused: no action)` };
    return { state, minutes_quiet, nudges, recommended_action: action, reason };
  };
  if (!input.alive) return result('dead', 'its process is gone', escalate);
  const quiet = quietMs >= input.stallMinutes * 60_000;
  const ladder = (): HealthAction => (nudges < MAX_NUDGES ? 'nudge' : escalate);
  if (input.status === 'busy') {
    return quiet ? result('hung', 'busy but no activity', ladder()) : result('ok', 'busy and active', 'none');
  }
  const idle = input.status === 'idle' ? 'idle' : 'no status file';
  if (!input.unfinished) {
    return result('ok', input.role === 'developer' ? `${idle}, done reported` : `${idle}, no goals in planning or in progress`, 'none');
  }
  if (!quiet) return result('ok', `${idle}, quiet under ${input.stallMinutes} min`, 'none');
  const work = input.role === 'developer' ? 'no done report yet' : 'goals still in planning or in progress';
  return result('stalled', `${idle} with ${work}`, ladder());
}

export interface SessionHealth extends HealthAssessment {
  session_id: number;
  name: string;
  role: HealthRole;
  status: ClaudeStatus;
  last_activity_ms: number;
}

function hasUnfinishedWork(db: DatabaseSync, session: Session): boolean {
  if (session.role === 'developer') {
    return one(db.prepare("SELECT 1 AS x FROM items WHERE raised_by = ? AND kind = 'done' LIMIT 1").get(session.id)) === undefined;
  }
  if (session.workstream_id === null) return false;
  return (
    one(db.prepare("SELECT 1 AS x FROM goals WHERE workstream_id = ? AND state IN ('planning', 'in-progress') LIMIT 1").get(session.workstream_id)) !==
    undefined
  );
}

function nudgeRecord(db: DatabaseSync, sessionId: number): NudgeRecord | undefined {
  ensure(db);
  return one<NudgeRecord>(db.prepare('SELECT count, last_nudge_at FROM health_nudges WHERE session_id = ?').get(sessionId));
}

function rosterMs(session: Session): number {
  const at = Date.parse(session.last_checkin_at ?? session.created_at);
  return Number.isFinite(at) ? at : 0;
}

/** Health of one architect or developer session (running, or stopped by death detection). */
export function sessionHealth(db: DatabaseSync, session: Session, readers: ActivityReaders, now: number): SessionHealth {
  if (session.role === 'front-desk') throw new Error('The front desk has no health check');
  const alive = session.state === 'running';
  const activity = readActivity(alive ? session.pid : null, rosterMs(session), readers);
  const assessment = assessHealth({
    role: session.role,
    alive,
    status: activity.status,
    lastActivityMs: activity.last_activity_ms,
    unfinished: hasUnfinishedWork(db, session),
    stallMinutes: getStallMinutes(db, session.project_id),
    nudge: nudgeRecord(db, session.id),
    paused: isPaused(db, session.project_id),
    now,
  });
  return {
    session_id: session.id,
    name: session.name ?? `session #${session.id}`,
    role: session.role,
    ...assessment,
    status: alive ? activity.status : 'unknown',
    last_activity_ms: activity.last_activity_ms,
  };
}

/** Increments the session's nudge count (reset first if it has been active since the last nudge). Returns the new count. */
export function recordNudge(db: DatabaseSync, sessionId: number, lastActivityMs: number, now: number): number {
  ensure(db);
  const count = effectiveNudges(nudgeRecord(db, sessionId), lastActivityMs) + 1;
  db.prepare(
    'INSERT INTO health_nudges (session_id, count, last_nudge_at) VALUES (?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET count = excluded.count, last_nudge_at = excluded.last_nudge_at',
  ).run(sessionId, count, now);
  return count;
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return one(db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)) !== undefined;
}

/** Sessions the monitor found dead whose death item is still open (nobody has dealt with them yet). */
export function unresolvedDeaths(db: DatabaseSync): Session[] {
  if (!hasTable(db, 'monitor_deaths')) return [];
  return many<Session>(
    db
      .prepare(
        `SELECT DISTINCT s.* FROM sessions s JOIN monitor_deaths d ON d.session_id = s.id JOIN items i ON i.id = d.item_id
         WHERE s.state = 'stopped' AND s.role <> 'front-desk' AND i.state <> 'closed' ORDER BY s.id`,
      )
      .all(),
  );
}

/** Closes the monitor's open death and stuck items about a session (after it was restarted). */
export function closeHealthItems(db: DatabaseSync, sessionId: number, now: Date = new Date()): void {
  ensure(db);
  const sources = ['SELECT item_id FROM health_episodes WHERE session_id = ?'];
  if (hasTable(db, 'monitor_deaths')) sources.push('SELECT item_id FROM monitor_deaths WHERE session_id = ?');
  db.prepare(`UPDATE items SET state = 'closed', updated_at = ? WHERE state <> 'closed' AND id IN (${sources.join(' UNION ')})`).run(
    iso(now),
    ...sources.map(() => sessionId),
  );
}

export interface StuckReport {
  session_id: number;
  name: string;
  state: HealthState;
  minutes_quiet: number;
  item_id: number;
}

function addressee(db: DatabaseSync, session: Session, now: Date): number {
  if (session.role === 'architect' || session.parent_id === null) return frontDesk(db, now).id;
  const parent = getSession(db, session.parent_id);
  return parent !== undefined && parent.state === 'running' ? parent.id : frontDesk(db, now).id;
}

/**
 * Watcher pass: raises ONE blocked item to the parent when a running session newly turns hung or stalled.
 * The same episode is never reported twice; activity after the report (beyond the grace) starts a new one.
 * Paused projects are skipped, and so are sessions without a claude pid (helpers we cannot observe).
 */
export function detectStuck(db: DatabaseSync, readers: ActivityReaders, now: Date = new Date()): StuckReport[] {
  ensure(db);
  const sessions = many<Session>(db.prepare("SELECT * FROM sessions WHERE state = 'running' AND role IN ('architect', 'developer') AND pid IS NOT NULL ORDER BY id").all());
  const reports: StuckReport[] = [];
  for (const session of sessions) {
    const health = sessionHealth(db, session, readers, now.getTime());
    if (health.state !== 'hung' && health.state !== 'stalled') continue;
    if (isPaused(db, session.project_id)) continue;
    const episode = one<{ reported_at: number }>(db.prepare('SELECT reported_at FROM health_episodes WHERE session_id = ?').get(session.id));
    if (episode !== undefined && health.last_activity_ms <= episode.reported_at + ACTIVITY_GRACE_MS) continue;
    const item = raiseItem(
      db,
      {
        kind: 'blocked',
        body: `${health.name} looks stuck: ${health.reason}, quiet ${health.minutes_quiet} min`,
        raisedBy: session.id,
        addressedTo: addressee(db, session, now),
      },
      now,
    );
    db.prepare(
      'INSERT INTO health_episodes (session_id, reported_at, item_id) VALUES (?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET reported_at = excluded.reported_at, item_id = excluded.item_id',
    ).run(session.id, now.getTime(), item.id);
    reports.push({ session_id: session.id, name: health.name, state: health.state, minutes_quiet: health.minutes_quiet, item_id: item.id });
  }
  return reports;
}
