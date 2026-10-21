import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from './db.ts';

export const GOAL_STATES = ['new', 'planning', 'awaiting-signoff', 'in-progress', 'done', 'cancelled'] as const;
export type GoalState = (typeof GOAL_STATES)[number];
const FINISHED: readonly string[] = ['done', 'cancelled'];

export interface Goal {
  id: number;
  workstream_id: number;
  text: string;
  state: GoalState;
  budget_usd: number | null;
  created_at: string;
  updated_at: string;
}

export interface GoalWithPlace extends Goal {
  project_id: number;
  project: string;
  workstream: string;
}

export interface GoalInput {
  workstreamId: number;
  text: string;
  budgetUsd?: number | null;
}

export interface GoalChange {
  state?: GoalState;
  text?: string;
  budgetUsd?: number | null;
}

const WITH_PLACE = `SELECT g.*, p.id AS project_id, p.name AS project, w.name AS workstream
  FROM goals g JOIN workstreams w ON w.id = g.workstream_id JOIN projects p ON p.id = w.project_id`;

export function createGoal(db: DatabaseSync, input: GoalInput, now: Date = new Date()): Goal {
  if (input.text.trim() === '') throw new Error('A goal needs some text');
  const result = db
    .prepare('INSERT INTO goals (workstream_id, text, state, budget_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.workstreamId, input.text, 'new', input.budgetUsd ?? null, iso(now), iso(now));
  return requireGoal(db, Number(result.lastInsertRowid));
}

export function getGoal(db: DatabaseSync, id: number): Goal | undefined {
  return one<Goal>(db.prepare('SELECT * FROM goals WHERE id = ?').get(id));
}

export function requireGoal(db: DatabaseSync, id: number): Goal {
  const goal = getGoal(db, id);
  if (goal === undefined) throw new Error(`Unknown goal #${id}`);
  return goal;
}

export function goalWithPlace(db: DatabaseSync, id: number): GoalWithPlace {
  const goal = one<GoalWithPlace>(db.prepare(`${WITH_PLACE} WHERE g.id = ?`).get(id));
  if (goal === undefined) throw new Error(`Unknown goal #${id}`);
  return goal;
}

export function updateGoal(db: DatabaseSync, id: number, change: GoalChange, now: Date = new Date()): Goal {
  const goal = requireGoal(db, id);
  if (change.state !== undefined && !(GOAL_STATES as readonly string[]).includes(change.state)) {
    throw new Error(`Unknown goal state "${change.state}"`);
  }
  if (FINISHED.includes(goal.state)) throw new Error(`Goal #${id} is ${goal.state} and cannot change`);
  db.prepare('UPDATE goals SET state = ?, text = ?, budget_usd = ?, updated_at = ? WHERE id = ?').run(
    change.state ?? goal.state,
    change.text ?? goal.text,
    change.budgetUsd === undefined ? goal.budget_usd : change.budgetUsd,
    iso(now),
    id,
  );
  return requireGoal(db, id);
}

export function activeGoals(db: DatabaseSync, projectId: number): GoalWithPlace[] {
  return many<GoalWithPlace>(
    db.prepare(`${WITH_PLACE} WHERE p.id = ? AND g.state NOT IN ('done', 'cancelled') ORDER BY g.id`).all(projectId),
  );
}
