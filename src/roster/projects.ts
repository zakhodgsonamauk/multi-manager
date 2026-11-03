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
  /** The model this project's tabs default to when a task has no scores; null means not set. */
  default_model: string | null;
  /** When the user hid it from the status and the pane; null while shown. Nothing is deleted. */
  archived_at: string | null;
  /** The user's standing rules for every session in this project, exactly as given; null when none. */
  standing_rules: string | null;
  /** 1 when this project uses code-review-graph (a local code-search tool); 0 when not (the default). */
  code_graph: number;
}

export interface Workstream {
  id: number;
  project_id: number;
  name: string;
  branch: string;
  /** When the user hid it from the status and the pane; null while shown. */
  archived_at: string | null;
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
  standingRules?: string;
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
        `INSERT INTO projects (name, folder, permission_mode, approval_rules, idle_stop_minutes, daily_budget_usd, created_at, default_model, standing_rules)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.folder,
        input.permissionMode ?? DEFAULT_PERMISSION_MODE,
        input.approvalRules ?? DEFAULT_APPROVAL_RULES,
        input.idleStopMinutes ?? DEFAULT_IDLE_STOP_MINUTES,
        input.dailyBudgetUsd ?? null,
        iso(now),
        null,
        input.standingRules === undefined || input.standingRules === '' ? null : input.standingRules,
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

export function getProjectDefaultModel(db: DatabaseSync, projectId: number): string | null {
  const row = one<{ default_model: string | null }>(db.prepare('SELECT default_model FROM projects WHERE id = ?').get(projectId));
  return row?.default_model ?? null;
}

export function setProjectDefaultModel(db: DatabaseSync, projectId: number, model: string | null): void {
  db.prepare('UPDATE projects SET default_model = ? WHERE id = ?').run(model, projectId);
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

/** A project by name, or by numeric id (as a number or as a string of digits when no project has that name). */
export function requireProjectRef(db: DatabaseSync, ref: string | number): Project {
  if (typeof ref === 'number') return requireProjectById(db, ref);
  const byName = getProject(db, ref);
  if (byName !== undefined) return byName;
  if (/^\d+$/.test(ref)) return requireProjectById(db, Number(ref));
  throw new Error(`Unknown project "${ref}"`);
}

export function listWorkstreams(db: DatabaseSync, projectRef: string | number): Workstream[] {
  const project = requireProjectRef(db, projectRef);
  return many<Workstream>(db.prepare('SELECT * FROM workstreams WHERE project_id = ? ORDER BY id').all(project.id));
}

/** Refuses to hide a scope while one of its architects is running: the user should stop it first. */
function refuseWhileRunning(db: DatabaseSync, projectId: number, workstreamId: number | null): void {
  const running = one<{ name: string | null; id: number; project: string; workstream: string }>(
    db
      .prepare(
        `SELECT s.id, s.name, p.name AS project, w.name AS workstream FROM sessions s
         JOIN workstreams w ON w.id = s.workstream_id JOIN projects p ON p.id = w.project_id
         WHERE s.role IN ('architect', 'project-manager') AND s.state = 'running' AND w.project_id = ? AND (? IS NULL OR w.id = ?)
         ORDER BY s.id LIMIT 1`,
      )
      .get(projectId, workstreamId, workstreamId),
  );
  if (running === undefined) return;
  const name = running.name ?? `session #${running.id}`;
  throw new Error(`${name} is still running for ${running.project}/${running.workstream}: stop it first, then hide it.`);
}

/** Hides (or shows again) a workstream in the status and the pane. Hiding is refused while its architect runs. */
export function setWorkstreamArchived(
  db: DatabaseSync,
  projectName: string,
  workstreamName: string,
  archived: boolean,
  now: Date = new Date(),
): Workstream {
  const project = requireProject(db, projectName);
  const workstream = requireWorkstream(db, project.id, workstreamName);
  if (archived) refuseWhileRunning(db, project.id, workstream.id);
  db.prepare('UPDATE workstreams SET archived_at = ? WHERE id = ?').run(archived ? iso(now) : null, workstream.id);
  return requireWorkstreamById(db, workstream.id);
}

/** Hides (or shows again) a project in the status and the pane. Hiding is refused while any of its architects runs. */
export function setProjectArchived(db: DatabaseSync, projectName: string, archived: boolean, now: Date = new Date()): Project {
  const project = requireProject(db, projectName);
  if (archived) refuseWhileRunning(db, project.id, null);
  db.prepare('UPDATE projects SET archived_at = ? WHERE id = ?').run(archived ? iso(now) : null, project.id);
  return requireProjectById(db, project.id);
}

export function addWorkstream(db: DatabaseSync, projectName: string, input: WorkstreamInput): Workstream {
  const project = requireProject(db, projectName);
  if (getWorkstream(db, project.id, input.name) !== undefined) {
    throw new Error(`Workstream "${input.name}" already exists in ${project.name}`);
  }
  insertWorkstream(db, project.id, input);
  return requireWorkstream(db, project.id, input.name);
}

/** Stores the user's standing rules for a project exactly as given (no trimming); empty text clears them. */
export function setProjectRules(db: DatabaseSync, projectName: string, text: string): Project {
  const project = requireProject(db, projectName);
  db.prepare('UPDATE projects SET standing_rules = ? WHERE id = ?').run(text === '' ? null : text, project.id);
  return requireProjectById(db, project.id);
}

/** Whether the project uses code-review-graph. Off for a new project. */
export function getCodeGraph(db: DatabaseSync, projectName: string): boolean {
  return requireProject(db, projectName).code_graph === 1;
}

/** Stores the switch only; the tool connection and watch list are changed by `src/codegraph/codegraph.ts`. */
export function setCodeGraph(db: DatabaseSync, projectName: string, enabled: boolean): Project {
  const project = requireProject(db, projectName);
  db.prepare('UPDATE projects SET code_graph = ? WHERE id = ?').run(enabled ? 1 : 0, project.id);
  return requireProjectById(db, project.id);
}
