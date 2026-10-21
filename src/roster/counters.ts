import type { DatabaseSync } from 'node:sqlite';
import { one, tx } from './db.ts';
import { requireProject, requireProjectById } from './projects.ts';

const COUNTERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS counters (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL COLLATE NOCASE,
  next INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind)
);`;

const ready = new WeakSet<DatabaseSync>();

function ensureCountersSchema(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(COUNTERS_SCHEMA);
  ready.add(db);
}

/**
 * Hands out the next number of a free-text kind ("task", "finding") for a project: unique and increasing,
 * across every session and database handle (BEGIN IMMEDIATE). `atLeast` seeds a counter from numbers a
 * project already used: the result is never below it.
 */
export function allocateNumber(db: DatabaseSync, project: string | number, kind: string, options: { atLeast?: number } = {}): number {
  const name = kind.trim();
  if (name === '') throw new Error('A number kind is required, e.g. task or finding');
  const atLeast = options.atLeast ?? 1;
  if (!Number.isInteger(atLeast)) throw new Error('at_least must be a whole number');
  const projectId = typeof project === 'number' ? requireProjectById(db, project).id : requireProject(db, project).id;
  ensureCountersSchema(db);
  return tx(db, () => {
    const row = one<{ next: number }>(db.prepare('SELECT next FROM counters WHERE project_id = ? AND kind = ?').get(projectId, name));
    const value = Math.max(row?.next ?? 1, atLeast);
    db.prepare(
      'INSERT INTO counters (project_id, kind, next) VALUES (?, ?, ?) ON CONFLICT (project_id, kind) DO UPDATE SET next = excluded.next',
    ).run(projectId, name, value + 1);
    return value;
  });
}

export function peekNumber(db: DatabaseSync, projectId: number, kind: string): number {
  ensureCountersSchema(db);
  return one<{ next: number }>(db.prepare('SELECT next FROM counters WHERE project_id = ? AND kind = ?').get(projectId, kind.trim()))?.next ?? 1;
}
