import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { iso, many, one } from './db.ts';
import { requireProjectById } from './projects.ts';
import type { Role, Session } from './sessions.ts';

/**
 * Pause and resume. Tables live here, created lazily, so db.ts stays untouched.
 * A pause covers the whole roster (project_id NULL) or one project. At pause time every running
 * session in scope gets a pause_reports row (reported_at NULL); report_paused fills it in.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS pauses (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  reason TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS pause_reports (
  id INTEGER PRIMARY KEY,
  pause_id INTEGER NOT NULL REFERENCES pauses(id),
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  note_path TEXT,
  summary TEXT,
  committed INTEGER,
  reported_at TEXT,
  UNIQUE (pause_id, session_id)
);
`;

const ready = new WeakSet<DatabaseSync>();

function ensure(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  ready.add(db);
}

export interface Pause {
  id: number;
  project_id: number | null;
  reason: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface PauseReport {
  id: number;
  pause_id: number;
  session_id: number;
  role: Role;
  note_path: string | null;
  summary: string | null;
  committed: number | null;
  reported_at: string | null;
}

export const PAUSE_ITEM_TEXT =
  'PAUSE: reach a clean point, commit WIP on your branch, write a resume note in your progress log, then call report_paused';

function scopeName(db: DatabaseSync, projectId: number | null): string {
  return projectId === null ? 'everything' : `project ${requireProjectById(db, projectId).name}`;
}

/** Active pauses that cover a project (its own and whole-roster ones). Without a project: whole-roster pauses only. */
export function activePauses(db: DatabaseSync, projectId?: number | null): Pause[] {
  ensure(db);
  const params: SQLInputValue[] = [];
  let where = 'ended_at IS NULL AND (project_id IS NULL';
  if (projectId !== undefined && projectId !== null) {
    where += ' OR project_id = ?';
    params.push(projectId);
  }
  return many<Pause>(db.prepare(`SELECT * FROM pauses WHERE ${where}) ORDER BY id`).all(...params));
}

/** True if everything is paused, or (with a project) that project is. */
export function isPaused(db: DatabaseSync, projectId?: number | null): boolean {
  return activePauses(db, projectId).length > 0;
}

/** The launch guard. Resume ends its pause before relaunching, so it passes this check. */
export function assertNotPaused(db: DatabaseSync, projectId: number | null): void {
  const pause = activePauses(db, projectId)[0];
  if (pause === undefined) return;
  throw new Error(
    `Not launching: ${scopeName(db, pause.project_id)} is paused (pause #${pause.id} since ${pause.started_at}). ` +
      'Nothing starts while paused. The front desk resumes with the resume tool after the user says go.',
  );
}

export function getPause(db: DatabaseSync, id: number): Pause | undefined {
  ensure(db);
  return one<Pause>(db.prepare('SELECT * FROM pauses WHERE id = ?').get(id));
}

export function requirePause(db: DatabaseSync, id: number): Pause {
  const pause = getPause(db, id);
  if (pause === undefined) throw new Error(`Unknown pause #${id}`);
  return pause;
}

/** The active pause with exactly this scope (null = whole roster). */
export function activePauseFor(db: DatabaseSync, projectId: number | null): Pause | undefined {
  ensure(db);
  const sql = `SELECT * FROM pauses WHERE ended_at IS NULL AND project_id ${projectId === null ? 'IS NULL' : '= ?'} ORDER BY id LIMIT 1`;
  return one<Pause>(db.prepare(sql).get(...(projectId === null ? [] : [projectId])));
}

/** Running sessions a pause covers. The front desk is never in scope. */
export function runningInScope(db: DatabaseSync, projectId: number | null): Session[] {
  const sql =
    "SELECT * FROM sessions WHERE state = 'running' AND role <> 'front-desk'" + (projectId === null ? '' : ' AND project_id = ?') + ' ORDER BY id';
  return many<Session>(db.prepare(sql).all(...(projectId === null ? [] : [projectId])));
}

export function startPause(db: DatabaseSync, input: { projectId: number | null; reason?: string }, now: Date = new Date()): { pause: Pause; sessions: Session[] } {
  ensure(db);
  const existing = input.projectId === null ? activePauseFor(db, null) : activePauses(db, input.projectId)[0];
  if (existing !== undefined) {
    throw new Error(`${scopeName(db, existing.project_id)} is already paused (pause #${existing.id}). Use pause_status.`);
  }
  const result = db
    .prepare('INSERT INTO pauses (project_id, reason, started_at) VALUES (?, ?, ?)')
    .run(input.projectId, input.reason ?? null, iso(now));
  const pause = requirePause(db, Number(result.lastInsertRowid));
  const sessions = runningInScope(db, input.projectId);
  const insert = db.prepare('INSERT INTO pause_reports (pause_id, session_id, role) VALUES (?, ?, ?)');
  for (const session of sessions) insert.run(pause.id, session.id, session.role);
  return { pause, sessions };
}

export function pauseReports(db: DatabaseSync, pauseId: number): PauseReport[] {
  ensure(db);
  return many<PauseReport>(db.prepare('SELECT * FROM pause_reports WHERE pause_id = ? ORDER BY session_id').all(pauseId));
}

/** Records a session's report on every active pause that covers it. */
export function reportPaused(
  db: DatabaseSync,
  session: Session,
  input: { notePath: string; summary: string; committed: boolean },
  now: Date = new Date(),
): PauseReport[] {
  const pauses = activePauses(db, session.project_id);
  if (pauses.length === 0) throw new Error('Nothing is paused for this session; there is nothing to report');
  const upsert = db.prepare(
    `INSERT INTO pause_reports (pause_id, session_id, role, note_path, summary, committed, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (pause_id, session_id) DO UPDATE SET note_path = excluded.note_path, summary = excluded.summary,
       committed = excluded.committed, reported_at = excluded.reported_at`,
  );
  return pauses.map((pause) => {
    upsert.run(pause.id, session.id, session.role, input.notePath, input.summary, input.committed ? 1 : 0, iso(now));
    return one<PauseReport>(db.prepare('SELECT * FROM pause_reports WHERE pause_id = ? AND session_id = ?').get(pause.id, session.id))!;
  });
}

export function endPause(db: DatabaseSync, pauseId: number, now: Date = new Date()): Pause {
  const pause = requirePause(db, pauseId);
  if (pause.ended_at !== null) throw new Error(`Pause #${pauseId} already ended at ${pause.ended_at}`);
  db.prepare('UPDATE pauses SET ended_at = ? WHERE id = ?').run(iso(now), pauseId);
  return requirePause(db, pauseId);
}
