import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from './db.ts';

export const ROLES = ['front-desk', 'architect', 'developer'] as const;
export type Role = (typeof ROLES)[number];
export type SessionState = 'running' | 'stopped';
export const FRONT_DESK_NAME = 'mm-front-desk';

export interface Session {
  id: number;
  role: Role;
  parent_id: number | null;
  project_id: number | null;
  workstream_id: number | null;
  name: string | null;
  pid: number | null;
  /** The pwsh wrapper that holds the session's kill-on-close Job (src/launch/wrapper.ts). */
  wrapper_pid: number | null;
  /** Claude Code's conversation id (sessionId in ~/.claude/sessions/<pid>.json), for `claude --resume`. */
  claude_session_id: string | null;
  /** The model this session runs on (haiku/sonnet/opus, or a manual Fable pull); null until set. */
  model: string | null;
  /** The architect's task score, 1..5: 1 trivial .. 5 hard. Null until scored. */
  complexity: number | null;
  /** The architect's task score, 1..5: 1 vague .. 5 fully specified. Null until scored. */
  clarity: number | null;
  folder: string | null;
  state: SessionState;
  last_checkin_at: string | null;
  created_at: string;
}

export interface SessionNode extends Session {
  children: SessionNode[];
}

export interface SessionInput {
  role: Role;
  parentId?: number | null;
  projectId?: number | null;
  workstreamId?: number | null;
  name?: string | null;
  pid?: number | null;
  folder?: string | null;
  state?: SessionState;
}

export function registerSession(db: DatabaseSync, input: SessionInput, now: Date = new Date()): Session {
  const result = db
    .prepare(
      `INSERT INTO sessions (role, parent_id, project_id, workstream_id, name, pid, folder, state, last_checkin_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.role,
      input.parentId ?? null,
      input.projectId ?? null,
      input.workstreamId ?? null,
      input.name ?? null,
      input.pid ?? null,
      input.folder ?? null,
      input.state ?? 'running',
      iso(now),
      iso(now),
    );
  return requireSession(db, Number(result.lastInsertRowid));
}

export function getSession(db: DatabaseSync, id: number): Session | undefined {
  return one<Session>(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
}

export function requireSession(db: DatabaseSync, id: number): Session {
  const session = getSession(db, id);
  if (session === undefined) throw new Error(`Unknown session #${id}`);
  return session;
}

export function checkIn(db: DatabaseSync, id: number, now: Date = new Date()): Session {
  requireSession(db, id);
  db.prepare('UPDATE sessions SET last_checkin_at = ? WHERE id = ?').run(iso(now), id);
  return requireSession(db, id);
}

export function setSessionState(db: DatabaseSync, id: number, state: SessionState): void {
  db.prepare('UPDATE sessions SET state = ? WHERE id = ?').run(state, id);
}

export function setSessionPid(db: DatabaseSync, id: number, pid: number | null): void {
  db.prepare('UPDATE sessions SET pid = ? WHERE id = ?').run(pid, id);
}

export function setSessionWrapperPid(db: DatabaseSync, id: number, pid: number | null): void {
  db.prepare('UPDATE sessions SET wrapper_pid = ? WHERE id = ?').run(pid, id);
}

export function setClaudeSessionId(db: DatabaseSync, id: number, claudeSessionId: string | null): void {
  db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(claudeSessionId, id);
}

export function setSessionModel(db: DatabaseSync, id: number, model: string | null): void {
  db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, id);
}

export function setSessionScores(db: DatabaseSync, id: number, complexity: number | null, clarity: number | null): void {
  db.prepare('UPDATE sessions SET complexity = ?, clarity = ? WHERE id = ?').run(complexity, clarity, id);
}

/** Brings a stopped session row back to running for a relaunch under the same roster id (restart after a crash). */
export function reviveSession(db: DatabaseSync, id: number, now: Date = new Date()): Session {
  db.prepare("UPDATE sessions SET state = 'running', pid = NULL, wrapper_pid = NULL, last_checkin_at = ? WHERE id = ?").run(iso(now), id);
  return requireSession(db, id);
}

/** The single front-desk record; created (stopped) if missing. More than one front desk is out of scope. */
export function frontDesk(db: DatabaseSync, now: Date = new Date()): Session {
  const existing = one<Session>(db.prepare("SELECT * FROM sessions WHERE role = 'front-desk' ORDER BY id LIMIT 1").get());
  if (existing !== undefined) return existing;
  return registerSession(db, { role: 'front-desk', name: FRONT_DESK_NAME, state: 'stopped' }, now);
}

/**
 * The front desk's session name when start_front_desk is given none: a cluster front desk tab sets
 * MM_FRONT_DESK_NAME (src/launch/front-desk-launch.ts) and the roster server inherits it; otherwise mm-front-desk.
 */
export function frontDeskNameFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.MM_FRONT_DESK_NAME?.trim();
  return name ? name : FRONT_DESK_NAME;
}

export function startFrontDesk(db: DatabaseSync, name: string = FRONT_DESK_NAME, now: Date = new Date()): Session {
  const desk = frontDesk(db, now);
  db.prepare("UPDATE sessions SET state = 'running', name = ?, last_checkin_at = ? WHERE id = ?").run(name, iso(now), desk.id);
  return requireSession(db, desk.id);
}

export function runningArchitect(db: DatabaseSync, workstreamId: number): Session | undefined {
  return one<Session>(
    db.prepare("SELECT * FROM sessions WHERE role = 'architect' AND state = 'running' AND workstream_id = ?").get(workstreamId),
  );
}

export function runningChildren(db: DatabaseSync, parentId: number): Session[] {
  return many<Session>(db.prepare("SELECT * FROM sessions WHERE parent_id = ? AND state = 'running' ORDER BY id").all(parentId));
}

export function sessionTree(db: DatabaseSync, options: { includeStopped?: boolean } = {}): SessionNode[] {
  const all = many<Session>(db.prepare('SELECT * FROM sessions ORDER BY id').all());
  const nodes = new Map<number, SessionNode>(all.map((s) => [s.id, { ...s, children: [] }]));
  const roots: SessionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? undefined : nodes.get(node.parent_id);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  if (options.includeStopped === true) return roots;
  const prune = (list: SessionNode[]): SessionNode[] =>
    list.flatMap((node) => {
      node.children = prune(node.children);
      return node.state === 'running' || node.children.length > 0 ? [node] : [];
    });
  return prune(roots);
}
