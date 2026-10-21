import type { DatabaseSync } from 'node:sqlite';
import type { BinaryCaps, Limits } from '../monitor/enforce.ts';
import { iso, many, one } from './db.ts';

const LIMITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS limits (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id),
  max_processes_per_session INTEGER,
  session_binary_caps TEXT NOT NULL DEFAULT '{}',
  machine_binary_caps TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);`;

const ready = new WeakSet<DatabaseSync>();

export function ensureLimitsSchema(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(LIMITS_SCHEMA);
  ready.add(db);
}

interface LimitsRow {
  project_id: number;
  max_processes_per_session: number | null;
  session_binary_caps: string;
  machine_binary_caps: string;
}

function fromRow(row: LimitsRow): Limits {
  return {
    project_id: row.project_id,
    max_processes_per_session: row.max_processes_per_session,
    session_binary_caps: JSON.parse(row.session_binary_caps) as BinaryCaps,
    machine_binary_caps: JSON.parse(row.machine_binary_caps) as BinaryCaps,
  };
}

export function normaliseCaps(caps: BinaryCaps): BinaryCaps {
  const result: BinaryCaps = {};
  for (const [binary, cap] of Object.entries(caps)) {
    const key = binary.trim().toLowerCase();
    if (key === '') throw new Error('A binary cap needs a process name, e.g. godot.exe');
    if (!Number.isInteger(cap) || cap < 0) throw new Error(`Cap for ${key} must be a whole number of 0 or more`);
    result[key] = cap;
  }
  return result;
}

export function getLimits(db: DatabaseSync, projectId: number): Limits {
  ensureLimitsSchema(db);
  const row = one<LimitsRow>(db.prepare('SELECT * FROM limits WHERE project_id = ?').get(projectId));
  return row === undefined
    ? { project_id: projectId, max_processes_per_session: null, session_binary_caps: {}, machine_binary_caps: {} }
    : fromRow(row);
}

export function listLimits(db: DatabaseSync): Limits[] {
  ensureLimitsSchema(db);
  return many<LimitsRow>(db.prepare('SELECT * FROM limits ORDER BY project_id').all()).map(fromRow);
}

export interface LimitsPatch {
  /** undefined keeps the current value; null removes the cap. */
  maxProcessesPerSession?: number | null;
  /** Replaces the whole map when given. */
  sessionBinaryCaps?: BinaryCaps;
  machineBinaryCaps?: BinaryCaps;
}

export function setLimits(db: DatabaseSync, projectId: number, patch: LimitsPatch, now: Date = new Date()): Limits {
  const current = getLimits(db, projectId);
  const max = patch.maxProcessesPerSession === undefined ? current.max_processes_per_session : patch.maxProcessesPerSession;
  if (max !== null && (!Number.isInteger(max) || max < 0)) throw new Error('max_processes_per_session must be a whole number of 0 or more');
  const next: Limits = {
    project_id: projectId,
    max_processes_per_session: max,
    session_binary_caps: patch.sessionBinaryCaps === undefined ? current.session_binary_caps : normaliseCaps(patch.sessionBinaryCaps),
    machine_binary_caps: patch.machineBinaryCaps === undefined ? current.machine_binary_caps : normaliseCaps(patch.machineBinaryCaps),
  };
  db.prepare(
    `INSERT INTO limits (project_id, max_processes_per_session, session_binary_caps, machine_binary_caps, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       max_processes_per_session = excluded.max_processes_per_session,
       session_binary_caps = excluded.session_binary_caps,
       machine_binary_caps = excluded.machine_binary_caps,
       updated_at = excluded.updated_at`,
  ).run(projectId, max, JSON.stringify(next.session_binary_caps), JSON.stringify(next.machine_binary_caps), iso(now));
  return getLimits(db, projectId);
}
