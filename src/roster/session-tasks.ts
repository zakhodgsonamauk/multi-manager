import type { DatabaseSync } from 'node:sqlite';
import { iso, one } from './db.ts';

/** Each launched developer's task and label, so a stalled developer can be relaunched with the same work. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_tasks (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id),
  label TEXT NOT NULL,
  task TEXT NOT NULL,
  created_at TEXT NOT NULL
);`;

const ready = new WeakSet<DatabaseSync>();

function ensure(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  ready.add(db);
}

export interface SessionTask {
  session_id: number;
  label: string;
  task: string;
  created_at: string;
}

export function saveSessionTask(db: DatabaseSync, sessionId: number, label: string, task: string, now: Date = new Date()): void {
  ensure(db);
  db.prepare(
    'INSERT INTO session_tasks (session_id, label, task, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET label = excluded.label, task = excluded.task',
  ).run(sessionId, label, task, iso(now));
}

export function getSessionTask(db: DatabaseSync, sessionId: number): SessionTask | undefined {
  ensure(db);
  return one<SessionTask>(db.prepare('SELECT * FROM session_tasks WHERE session_id = ?').get(sessionId));
}
