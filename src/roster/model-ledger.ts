import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from './db.ts';

/**
 * A ledger of model changes: set_session_model overrides and the architect's manual Fable pulls.
 * The front desk reads this to report where expensive models were spent.
 */
export interface ModelChange {
  id: number;
  session_id: number | null;
  from_model: string | null;
  to_model: string;
  reason: string | null;
  at: string;
}

export interface ModelUsageRow extends ModelChange {
  session_name: string | null;
  project: string | null;
}

export function recordModelChange(
  db: DatabaseSync,
  input: { sessionId: number | null; fromModel: string | null; toModel: string; reason: string | null },
  now: Date = new Date(),
): ModelChange {
  const result = db
    .prepare('INSERT INTO model_ledger (session_id, from_model, to_model, reason, at) VALUES (?, ?, ?, ?, ?)')
    .run(input.sessionId, input.fromModel, input.toModel, input.reason, iso(now));
  const row = one<ModelChange>(db.prepare('SELECT * FROM model_ledger WHERE id = ?').get(Number(result.lastInsertRowid)));
  if (row === undefined) throw new Error('Failed to read the model change just recorded');
  return row;
}

export function listModelUsage(db: DatabaseSync, options: { projectId?: number; limit?: number } = {}): ModelUsageRow[] {
  const limit = options.limit ?? 25;
  if (options.projectId === undefined) {
    return many<ModelUsageRow>(
      db
        .prepare(
          `SELECT ml.*, s.name AS session_name, p.name AS project
           FROM model_ledger ml
           LEFT JOIN sessions s ON s.id = ml.session_id
           LEFT JOIN projects p ON p.id = s.project_id
           ORDER BY ml.id DESC LIMIT ?`,
        )
        .all(limit),
    );
  }
  return many<ModelUsageRow>(
    db
      .prepare(
        `SELECT ml.*, s.name AS session_name, p.name AS project
         FROM model_ledger ml
         JOIN sessions s ON s.id = ml.session_id
         JOIN projects p ON p.id = s.project_id
         WHERE p.id = ?
         ORDER BY ml.id DESC LIMIT ?`,
      )
      .all(options.projectId, limit),
  );
}
