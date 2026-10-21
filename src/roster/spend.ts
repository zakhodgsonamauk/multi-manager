import type { DatabaseSync } from 'node:sqlite';
import { iso, tx } from './db.ts';
import { goalWithPlace, requireGoal } from './goals.ts';
import { raiseItem, type Item } from './items.ts';
import { requireProjectById } from './projects.ts';
import { frontDesk, requireSession } from './sessions.ts';

export interface SpendInput {
  usd: number;
  sessionId?: number | null;
  goalId?: number | null;
  projectId?: number | null;
}

export interface SpendResult {
  id: number;
  project_id: number;
  goal_total_usd: number | null;
  project_today_usd: number;
  raised: Item[];
}

/** Spend days are UTC calendar days. */
export function utcDay(now: Date): string {
  return iso(now).slice(0, 10);
}

export function spendToday(db: DatabaseSync, projectId: number, now: Date = new Date()): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE project_id = ? AND substr(at, 1, 10) = ?')
    .get(projectId, utcDay(now));
  return Number(row?.total ?? 0);
}

export function spendForGoal(db: DatabaseSync, goalId: number): number {
  const row = db.prepare('SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE goal_id = ?').get(goalId);
  return Number(row?.total ?? 0);
}

function spendProject(db: DatabaseSync, input: SpendInput): number {
  if (input.projectId != null) return requireProjectById(db, input.projectId).id;
  if (input.goalId != null) return goalWithPlace(db, input.goalId).project_id;
  if (input.sessionId != null) {
    const session = requireSession(db, input.sessionId);
    if (session.project_id !== null) return session.project_id;
  }
  throw new Error('Cannot tell which project this spend belongs to: pass a goal or a project');
}

export function reportSpend(db: DatabaseSync, input: SpendInput, now: Date = new Date()): SpendResult {
  if (!Number.isFinite(input.usd) || input.usd < 0) throw new Error('Spend must be a non-negative number of USD');
  return tx(db, () => {
    const projectId = spendProject(db, input);
    const goal = input.goalId != null ? requireGoal(db, input.goalId) : undefined;
    const goalBefore = goal === undefined ? 0 : spendForGoal(db, goal.id);
    const dayBefore = spendToday(db, projectId, now);
    const result = db
      .prepare('INSERT INTO spend (session_id, goal_id, project_id, usd, at) VALUES (?, ?, ?, ?, ?)')
      .run(input.sessionId ?? null, goal?.id ?? null, projectId, input.usd, iso(now));
    const deskId = frontDesk(db, now).id;
    const raisedBy = input.sessionId ?? null;
    const raised: Item[] = [];
    const goalAfter = goalBefore + input.usd;
    if (goal !== undefined && goal.budget_usd !== null && goalBefore <= goal.budget_usd && goalAfter > goal.budget_usd) {
      raised.push(
        raiseItem(
          db,
          {
            kind: 'blocked',
            goalId: goal.id,
            raisedBy,
            addressedTo: deskId,
            body: `Goal #${goal.id} is over budget: $${goalAfter.toFixed(2)} spent of $${goal.budget_usd.toFixed(2)}.`,
          },
          now,
        ),
      );
    }
    const project = requireProjectById(db, projectId);
    const dayAfter = dayBefore + input.usd;
    if (project.daily_budget_usd !== null && dayBefore <= project.daily_budget_usd && dayAfter > project.daily_budget_usd) {
      raised.push(
        raiseItem(
          db,
          {
            kind: 'info',
            goalId: goal?.id ?? null,
            raisedBy,
            addressedTo: deskId,
            body: `Project ${project.name} is over its daily budget: $${dayAfter.toFixed(2)} spent today (UTC) of $${project.daily_budget_usd.toFixed(2)}.`,
          },
          now,
        ),
      );
    }
    return {
      id: Number(result.lastInsertRowid),
      project_id: projectId,
      goal_total_usd: goal === undefined ? null : goalAfter,
      project_today_usd: dayAfter,
      raised,
    };
  });
}
