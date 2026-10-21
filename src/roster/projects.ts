import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one, tx } from './db.ts';

export const DEFAULT_PERMISSION_MODE = 'dangerously-skip-permissions';
export const DEFAULT_APPROVAL_RULES =
  "User signs off on the high-level plan and the high-level testing approach: unit tests, end-to-end tests, and the architect's own browser click-through of every user-facing change to judge UI design and flow";
export const DEFAULT_IDLE_STOP_MINUTES = 120;
export const MAIN_WORKSTREAM = 'main';

export interface Project {
  id: number;
  name: string;
  folder: string;
  permission_mode: string;
  approval_rules: string;
  idle_stop_minutes: number;
  daily_budget_usd: number | null;
  created_at: string;
}

export interface Workstream {
  id: number;
  project_id: number;
  name: string;
  branch: string;
}

export interface WorkstreamInput {
  name: string;
  branch: string;
}

export interface ProjectInput {
  name: string;
  folder: string;
  permissionMode?: string;
  approvalRules?: string;
  idleStopMinutes?: number;
  dailyBudgetUsd?: number | null;
  workstreams?: WorkstreamInput[];
}

export function getProject(db: DatabaseSync, name: string): Project | undefined {
  return one<Project>(db.prepare('SELECT * FROM projects WHERE name = ?').get(name));
}

export function requireProject(db: DatabaseSync, name: string): Project {
  const project = getProject(db, name);
  if (project === undefined) throw new Error(`Unknown project "${name}"`);
  return project;
}

export function requireProjectById(db: DatabaseSync, id: number): Project {
  const project = one<Project>(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  if (project === undefined) throw new Error(`Unknown project #${id}`);
  return project;
}

export function listProjects(db: DatabaseSync): Project[] {
  return many<Project>(db.prepare('SELECT * FROM projects ORDER BY name').all());
}

function insertWorkstream(db: DatabaseSync, projectId: number, input: WorkstreamInput): void {
  db.prepare('INSERT INTO workstreams (project_id, name, branch) VALUES (?, ?, ?)').run(projectId, input.name, input.branch);
}

export function addProject(db: DatabaseSync, input: ProjectInput, now: Date = new Date()): Project {
  if (getProject(db, input.name) !== undefined) throw new Error(`Project "${input.name}" already exists`);
  return tx(db, () => {
    const result = db
      .prepare(
        `INSERT INTO projects (name, folder, permission_mode, approval_rules, idle_stop_minutes, daily_budget_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.folder,
        input.permissionMode ?? DEFAULT_PERMISSION_MODE,
        input.approvalRules ?? DEFAULT_APPROVAL_RULES,
        input.idleStopMinutes ?? DEFAULT_IDLE_STOP_MINUTES,
        input.dailyBudgetUsd ?? null,
        iso(now),
      );
    const projectId = Number(result.lastInsertRowid);
    const extra = input.workstreams ?? [];
    const main = extra.find((w) => w.name === MAIN_WORKSTREAM);
    insertWorkstream(db, projectId, { name: MAIN_WORKSTREAM, branch: main?.branch ?? MAIN_WORKSTREAM });
    for (const workstream of extra) {
      if (workstream.name !== MAIN_WORKSTREAM) insertWorkstream(db, projectId, workstream);
    }
    return requireProjectById(db, projectId);
  });
}

export function getWorkstream(db: DatabaseSync, projectId: number, name: string): Workstream | undefined {
  return one<Workstream>(db.prepare('SELECT * FROM workstreams WHERE project_id = ? AND name = ?').get(projectId, name));
}

export function requireWorkstream(db: DatabaseSync, projectId: number, name: string): Workstream {
  const workstream = getWorkstream(db, projectId, name);
  if (workstream === undefined) throw new Error(`Unknown workstream "${name}" in project #${projectId}`);
  return workstream;
}

export function requireWorkstreamById(db: DatabaseSync, id: number): Workstream {
  const workstream = one<Workstream>(db.prepare('SELECT * FROM workstreams WHERE id = ?').get(id));
  if (workstream === undefined) throw new Error(`Unknown workstream #${id}`);
  return workstream;
}

export function listWorkstreams(db: DatabaseSync, projectName: string): Workstream[] {
  const project = requireProject(db, projectName);
  return many<Workstream>(db.prepare('SELECT * FROM workstreams WHERE project_id = ? ORDER BY id').all(project.id));
}

export function addWorkstream(db: DatabaseSync, projectName: string, input: WorkstreamInput): Workstream {
  const project = requireProject(db, projectName);
  if (getWorkstream(db, project.id, input.name) !== undefined) {
    throw new Error(`Workstream "${input.name}" already exists in ${project.name}`);
  }
  insertWorkstream(db, project.id, input);
  return requireWorkstream(db, project.id, input.name);
}
