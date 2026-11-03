import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { iso, many } from './db.ts';
import { activeGoals } from './goals.ts';
import type { ItemKind, ItemState } from './items.ts';
import { listProjects, listWorkstreams, type Project, type Workstream } from './projects.ts';
import { frontDesk, runningArchitect, runningProjectManager, type Session } from './sessions.ts';
import { spendForGoal, spendToday } from './spend.ts';

export const STALE_AFTER_MINUTES = 30;

export interface ArchitectStatus {
  session_id: number;
  name: string | null;
  pid: number | null;
  last_checkin_at: string | null;
  minutes_since_checkin: number | null;
  stale: boolean;
  /** The running project manager's session id, or null when the front desk is its parent. */
  managed_by: number | null;
}

export interface ProjectManagerStatus {
  session_id: number;
  name: string | null;
  state: string;
  model: string | null;
  last_checkin_at: string | null;
}

export interface WorkstreamStatus {
  name: string;
  branch: string;
  architect: ArchitectStatus | null;
}

/** The most characters (the task allows 300; 250 leaves room under the size goal) of a goal text, item body or item answer the status summary carries. */
export const STATUS_TEXT_MAX = 250;

/** Cuts text to at most STATUS_TEXT_MAX characters, ending with the note saying where the full text lives. */
function cutText(text: string, note: string): { text: string; cut: boolean } {
  if (text.length <= STATUS_TEXT_MAX) return { text, cut: false };
  return { text: `${text.slice(0, STATUS_TEXT_MAX - note.length)}${note}`, cut: true };
}

/** A goal in the summary. `text` is cut to 250 characters (text_cut: true then); the full text is `get_goal N`. */
export interface GoalStatus {
  id: number;
  workstream: string;
  text: string;
  text_cut?: true;
  state: string;
  budget_usd: number | null;
  spent_usd: number;
}

/** An item in the summary. `body` and `answer` are cut to 250 characters (body_cut / answer_cut then); the full text is `list_items`. */
export interface ItemStatus {
  id: number;
  kind: ItemKind;
  state: ItemState;
  body: string;
  body_cut?: true;
  answer: string | null;
  answer_cut?: true;
  goal_id: number | null;
  raised_by: string | null;
  /** Whether the raiser's session is still running: answering a stopped one reaches nobody. */
  raised_by_running: boolean;
  addressed_to: string | null;
  seen: boolean;
  created_at: string;
}

export interface ProjectStatus {
  name: string;
  folder: string;
  permission_mode: string;
  idle_stop_minutes: number;
  daily_budget_usd: number | null;
  spend_today_usd: number;
  /** The running project manager, or null when none runs. Its `pm` workstream is not listed in `workstreams`. */
  project_manager: ProjectManagerStatus | null;
  workstreams: WorkstreamStatus[];
  active_goals: GoalStatus[];
  open_items: ItemStatus[];
}

export interface StatusSummary {
  generated_at: string;
  stale_after_minutes: number;
  waiting_for_user: ItemStatus[];
  projects: ProjectStatus[];
}

const ITEM_SELECT = `SELECT i.id, i.kind, i.state, i.body, i.answer, i.goal_id, i.seen, i.created_at,
    r.name AS raised_by, CASE WHEN r.state = 'running' THEN 1 ELSE 0 END AS raised_by_running, a.name AS addressed_to
  FROM items i
  LEFT JOIN goals g ON g.id = i.goal_id
  LEFT JOIN workstreams w ON w.id = g.workstream_id
  LEFT JOIN sessions r ON r.id = i.raised_by
  LEFT JOIN sessions a ON a.id = i.addressed_to`;

function itemRows(db: DatabaseSync, where: string, params: SQLInputValue[]): ItemStatus[] {
  const rows = many<Omit<ItemStatus, 'seen' | 'raised_by_running'> & { seen: number; raised_by_running: number }>(
    db.prepare(`${ITEM_SELECT} ${where} ORDER BY i.created_at, i.id`).all(...params),
  );
  const note = ' … (full text: list_items)';
  return rows.map((row) => {
    const body = cutText(row.body, note);
    const answer = row.answer === null ? null : cutText(row.answer, note);
    return {
      ...row,
      body: body.text,
      ...(body.cut ? { body_cut: true as const } : {}),
      answer: answer === null ? null : answer.text,
      ...(answer?.cut === true ? { answer_cut: true as const } : {}),
      seen: row.seen === 1,
      raised_by_running: row.raised_by_running === 1,
    };
  });
}

function architectStatus(session: Session | undefined, now: Date, staleAfter: number, managerId: number | null): ArchitectStatus | null {
  if (session === undefined) return null;
  const minutes =
    session.last_checkin_at === null ? null : Math.floor((now.getTime() - Date.parse(session.last_checkin_at)) / 60_000);
  return {
    session_id: session.id,
    name: session.name,
    pid: session.pid,
    last_checkin_at: session.last_checkin_at,
    minutes_since_checkin: minutes,
    stale: minutes === null || minutes > staleAfter,
    managed_by: managerId !== null && session.parent_id === managerId ? managerId : null,
  };
}

/** Hidden workstreams drop out, unless an architect runs there again: a running architect is never hidden. */
function shownWorkstreams(db: DatabaseSync, project: Project): { workstream: Workstream; architect: Session | undefined }[] {
  return listWorkstreams(db, project.name)
    .map((workstream) => ({ workstream, architect: runningArchitect(db, workstream.id) }))
    .filter(({ workstream, architect }) => workstream.archived_at === null || architect !== undefined);
}

function projectStatus(db: DatabaseSync, project: Project, now: Date, staleAfter: number): ProjectStatus {
  const pm = runningProjectManager(db, project.id);
  // The pm workstream is the project manager's own seat: it is listed as the project manager, not as a workstream.
  const shown = shownWorkstreams(db, project).filter(({ workstream }) => pm === undefined || workstream.id !== pm.workstream_id);
  const pmName = pm === undefined ? '' : (listWorkstreams(db, project.name).find((w) => w.id === pm.workstream_id)?.name.toLowerCase() ?? '');
  const shownNames = new Set(shown.map(({ workstream }) => workstream.name.toLowerCase()));
  return {
    name: project.name,
    folder: project.folder,
    permission_mode: project.permission_mode,
    idle_stop_minutes: project.idle_stop_minutes,
    daily_budget_usd: project.daily_budget_usd,
    spend_today_usd: spendToday(db, project.id, now),
    project_manager:
      pm === undefined ? null : { session_id: pm.id, name: pm.name, state: pm.state, model: pm.model, last_checkin_at: pm.last_checkin_at },
    workstreams: shown.map(({ workstream, architect }) => ({
      name: workstream.name,
      branch: workstream.branch,
      architect: architectStatus(architect, now, staleAfter, pm?.id ?? null),
    })),
    // A hidden workstream's goals hide with it.
    active_goals: activeGoals(db, project.id)
      .filter((g) => shownNames.has(g.workstream.toLowerCase()) || (pm !== undefined && g.workstream.toLowerCase() === pmName))
      .map((g) => {
        const text = cutText(g.text, ` … (full text: get_goal ${g.id})`);
        return {
        id: g.id,
        workstream: g.workstream,
        text: text.text,
        ...(text.cut ? { text_cut: true as const } : {}),
        state: g.state,
        budget_usd: g.budget_usd,
        spent_usd: spendForGoal(db, g.id),
        };
      }),
    open_items: itemRows(db, "WHERE i.state <> 'closed' AND (w.project_id = ? OR (i.goal_id IS NULL AND r.project_id = ?))", [
      project.id,
      project.id,
    ]),
  };
}

export function statusSummary(db: DatabaseSync, now: Date = new Date(), staleAfterMinutes: number = STALE_AFTER_MINUTES): StatusSummary {
  const desk = frontDesk(db, now);
  return {
    generated_at: iso(now),
    stale_after_minutes: staleAfterMinutes,
    waiting_for_user: itemRows(db, "WHERE i.addressed_to = ? AND i.state = 'open'", [desk.id]),
    projects: listProjects(db)
      .filter((project) => project.archived_at === null || shownWorkstreams(db, project).some((w) => w.architect !== undefined))
      .map((project) => projectStatus(db, project, now, staleAfterMinutes)),
  };
}
