import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Env = Record<string, string | undefined>;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  folder TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  approval_rules TEXT NOT NULL,
  idle_stop_minutes INTEGER NOT NULL,
  daily_budget_usd REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workstreams (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL COLLATE NOCASE,
  branch TEXT NOT NULL,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('front-desk', 'architect', 'developer')),
  parent_id INTEGER REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  workstream_id INTEGER REFERENCES workstreams(id),
  name TEXT,
  pid INTEGER,
  wrapper_pid INTEGER,
  claude_session_id TEXT,
  folder TEXT,
  state TEXT NOT NULL CHECK (state IN ('running', 'stopped')),
  last_checkin_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_architect_per_workstream
  ON sessions (workstream_id) WHERE role = 'architect' AND state = 'running';
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  workstream_id INTEGER NOT NULL REFERENCES workstreams(id),
  text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('new', 'planning', 'awaiting-signoff', 'in-progress', 'done', 'cancelled')),
  budget_usd REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER REFERENCES goals(id),
  raised_by INTEGER REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('signoff', 'question', 'blocked', 'done', 'info')),
  body TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
  answer TEXT,
  addressed_to INTEGER NOT NULL REFERENCES sessions(id),
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL COLLATE NOCASE,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  claimed_at TEXT NOT NULL,
  UNIQUE (project_id, path)
);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  goal_id INTEGER REFERENCES goals(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  usd REAL NOT NULL,
  at TEXT NOT NULL
);
`;

export function resolveDbPath(env: Env = process.env): string {
  const override = env.MM_ROSTER_DB;
  if (override !== undefined && override !== '') return override;
  return join(homedir(), '.claude', 'multi-manager', 'roster.db');
}

export function openRoster(path: string = resolveDbPath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after a table first shipped; CREATE TABLE IF NOT EXISTS does not add them to an old file. */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [
  { table: 'sessions', column: 'wrapper_pid', type: 'INTEGER' },
  { table: 'sessions', column: 'claude_session_id', type: 'TEXT' },
];

export function migrate(db: DatabaseSync): void {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Runs fn inside BEGIN IMMEDIATE … COMMIT. Do not nest. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function iso(now: Date): string {
  return now.toISOString();
}

/** node:sqlite rows have a null prototype; copy them into plain objects. */
export function one<T>(row: unknown): T | undefined {
  return row === undefined ? undefined : ({ ...(row as object) } as T);
}

export function many<T>(rows: readonly unknown[]): T[] {
  return rows.map((row) => ({ ...(row as object) }) as T);
}
