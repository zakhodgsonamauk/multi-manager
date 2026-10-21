import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from './db.ts';
import type { Role } from './sessions.ts';

export interface Claim {
  id: number;
  project_id: number;
  path: string;
  session_id: number;
  claimed_at: string;
}

export interface ClaimHolder {
  session_id: number;
  name: string | null;
  role: Role;
  claimed_at: string;
}

export type ClaimResult =
  | { ok: true; path: string }
  | { ok: false; path: string; holder: ClaimHolder; message: string };

/** File paths or heavy-job names: backslashes become slashes and a leading ./ is dropped. The column ignores case. */
export function normaliseClaimPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function claim(db: DatabaseSync, projectId: number, path: string, sessionId: number, now: Date = new Date()): ClaimResult {
  const normalised = normaliseClaimPath(path);
  db.prepare('INSERT OR IGNORE INTO claims (project_id, path, session_id, claimed_at) VALUES (?, ?, ?, ?)').run(
    projectId,
    normalised,
    sessionId,
    iso(now),
  );
  const holder = one<ClaimHolder & { path: string }>(
    db
      .prepare(
        `SELECT c.session_id, c.path, s.name, s.role, c.claimed_at FROM claims c JOIN sessions s ON s.id = c.session_id
         WHERE c.project_id = ? AND c.path = ?`,
      )
      .get(projectId, normalised),
  );
  if (holder === undefined) throw new Error(`Could not claim ${normalised}`);
  if (holder.session_id === sessionId) return { ok: true, path: holder.path };
  return {
    ok: false,
    path: holder.path,
    holder: { session_id: holder.session_id, name: holder.name, role: holder.role, claimed_at: holder.claimed_at },
    message: `${holder.path} is claimed by ${holder.name ?? 'an unnamed session'} (session #${holder.session_id}, ${holder.role}) since ${holder.claimed_at}`,
  };
}

export function release(db: DatabaseSync, projectId: number, path: string, sessionId: number): boolean {
  const result = db
    .prepare('DELETE FROM claims WHERE project_id = ? AND path = ? AND session_id = ?')
    .run(projectId, normaliseClaimPath(path), sessionId);
  return Number(result.changes) > 0;
}

export function releaseAll(db: DatabaseSync, sessionId: number): number {
  return Number(db.prepare('DELETE FROM claims WHERE session_id = ?').run(sessionId).changes);
}

export function listClaims(db: DatabaseSync, projectId: number): Claim[] {
  return many<Claim>(db.prepare('SELECT * FROM claims WHERE project_id = ? ORDER BY id').all(projectId));
}
