import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { sessionIdFromEnv } from '../hooks/common.ts';
import {
  changeSessionModel,
  launchArchitect,
  launchDeveloper,
  launchProjectManager,
  permissionWarning,
  stopArchitect,
  stopProjectManager,
  stopSession,
  type LaunchContext,
} from '../launch/launcher.ts';
import { claim, release } from './claims.ts';
import type { Env } from './db.ts';
import { GOAL_STATES, createGoal, goalWithPlace, updateGoal } from './goals.ts';
import { ITEM_KINDS, ITEM_STATES, answerItem, answerReply, closeItem, listItems, markSeen, raiseItem, requireItem } from './items.ts';
import { listModelUsage, recordModelChange } from './model-ledger.ts';
import { WORK_MODELS } from './models.ts';
import {
  addProject,
  addWorkstream,
  listProjects,
  listWorkstreams,
  requireProject,
  requireWorkstream,
  setProjectDefaultModel,
  setProjectRules,
} from './projects.ts';
import {
  FRONT_DESK_NAME,
  ROLES,
  checkIn,
  frontDesk,
  frontDeskNameFromEnv,
  getSession,
  registerSession,
  requireSession,
  sessionTree,
  startFrontDesk,
  type Role,
  type Session,
} from './sessions.ts';
import { reportSpend, spendForGoal } from './spend.ts';
import { statusSummary } from './status.ts';
import { registerPauseTools } from './tools-pause.ts';
import { registerMonitorTools } from './tools-monitor.ts';
import { registerHealthTools } from './tools-health.ts';
import { registerVoiceTools } from './tools-voice.ts';
import { registerRecoveryTools } from './tools-recovery.ts';
import { registerTidyTools } from './tools-tidy.ts';

export interface Identity {
  sessionId: number | null;
  role: Role | null;
}

export interface ToolContext {
  db: DatabaseSync;
  identity: Identity;
  pluginRoot: string;
  launch: LaunchContext;
}

export function identityFromEnv(env: Env): Identity {
  const role = ROLES.find((r) => r === env.MM_ROLE) ?? null;
  return { sessionId: sessionIdFromEnv(env), role };
}

export function briefing(pluginRoot: string, role: Role): { role: Role; path: string; plugin_root: string; text: string } {
  const path = join(pluginRoot, 'briefings', `${role}.md`);
  return { role, path, plugin_root: pluginRoot, text: readFileSync(path, 'utf8') };
}

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

export function me(ctx: ToolContext): Session {
  if (ctx.identity.sessionId === null) {
    throw new Error(
      'This session is not registered with the roster. Front desk: run /multi-manager:front-desk first. ' +
        'Architects and developers get their identity from the launcher.',
    );
  }
  return requireSession(ctx.db, ctx.identity.sessionId);
}

function projectIdFor(ctx: ToolContext, project: string | undefined): number {
  if (project !== undefined) return requireProject(ctx.db, project).id;
  const session = me(ctx);
  if (session.project_id === null) throw new Error('Name the project: this session has none');
  return session.project_id;
}

function nudge(ctx: ToolContext, sessionId: number, itemId: number): { to: string | null; message: string } {
  return { to: getSession(ctx.db, sessionId)?.name ?? null, message: `check roster item #${itemId}` };
}

/** The start_front_desk answer: briefing, who you are, then the compact status (waiting items first). */
export function frontDeskStartText(db: DatabaseSync, pluginRoot: string, desk: Session): string {
  return [
    briefing(pluginRoot, 'front-desk').text,
    `## You are roster session #${desk.id} (${desk.name ?? FRONT_DESK_NAME})`,
    '## Status (waiting items first)',
    JSON.stringify(statusSummary(db)),
  ].join('\n\n');
}

export function registerRosterTools(server: McpServer, ctx: ToolContext): void {
  const { db } = ctx;

  server.registerTool(
    'start_front_desk',
    {
      description:
        'Make this session the Multi-Manager front desk (reuses the single front-desk record), install the Windows Terminal profile, and return the front-desk briefing plus the status with waiting items first.',
      inputSchema: {
        name: z.string().optional().describe('This session\'s -n name; default MM_FRONT_DESK_NAME (a cluster front desk), else mm-front-desk'),
      },
    },
    ({ name }) =>
      guard(() => {
        const desk = startFrontDesk(db, name ?? frontDeskNameFromEnv());
        ctx.identity = { sessionId: desk.id, role: 'front-desk' };
        ctx.launch.deps.ensureTerminalProfile();
        return frontDeskStartText(db, ctx.pluginRoot, desk);
      }),
  );

  server.registerTool(
    'get_briefing',
    { description: 'Return a role briefing (text and file path) and the plugin root.', inputSchema: { role: z.enum(ROLES) } },
    ({ role }) => guard(() => briefing(ctx.pluginRoot, role)),
  );

  server.registerTool(
    'add_project',
    {
      description: 'Add a project. It always gets a main workstream; pass more workstreams with their branches.',
      inputSchema: {
        name: z.string().min(1),
        folder: z.string().min(1).describe('Absolute path of the project folder'),
        permission_mode: z.string().optional().describe('Default dangerously-skip-permissions'),
        approval_rules: z.string().optional(),
        idle_stop_minutes: z.number().int().positive().optional(),
        daily_budget_usd: z.number().nonnegative().optional(),
        standing_rules: z.string().optional().describe("The user's standing rules for every session in this project, stored exactly as given"),
        workstreams: z.array(z.object({ name: z.string().min(1), branch: z.string().min(1) })).optional(),
      },
    },
    (a) =>
      guard(() => {
        const project = addProject(db, {
          standingRules: a.standing_rules,
          name: a.name,
          folder: a.folder,
          permissionMode: a.permission_mode,
          approvalRules: a.approval_rules,
          idleStopMinutes: a.idle_stop_minutes,
          dailyBudgetUsd: a.daily_budget_usd,
          workstreams: a.workstreams,
        });
        return { project, workstreams: listWorkstreams(db, project.name), warning: permissionWarning(project) };
      }),
  );

  server.registerTool('list_projects', { description: 'List all projects with their settings and standing user rules.', inputSchema: {} }, () =>
    guard(() => listProjects(db)),
  );

  server.registerTool(
    'set_project_rules',
    {
      description:
        "Store the user's standing rules for a project, exactly as the user gave them (no trimming); every session of that project is shown them at start-up. Empty text clears them. Front desk, or that project's running project manager.",
      inputSchema: { project: z.string().min(1), text: z.string() },
    },
    (a) =>
      guard(() => {
        const caller = me(ctx);
        const project = requireProject(db, a.project);
        const allowed = caller.role === 'front-desk' || (caller.role === 'project-manager' && caller.state === 'running' && caller.project_id === project.id);
        if (!allowed) throw new Error(`Only the front desk or ${project.name}'s project manager can set its standing rules`);
        return setProjectRules(db, project.name, a.text);
      }),
  );

  server.registerTool(
    'add_workstream',
    { description: 'Add a workstream (name and branch) to a project.', inputSchema: { project: z.string(), name: z.string().min(1), branch: z.string().min(1) } },
    (a) => guard(() => addWorkstream(db, a.project, { name: a.name, branch: a.branch })),
  );

  server.registerTool(
    'list_workstreams',
    { description: 'List the workstreams of a project (name or numeric id).', inputSchema: { project: z.union([z.string(), z.number().int().positive()]) } },
    ({ project }) => guard(() => listWorkstreams(db, project)),
  );

  server.registerTool(
    'register_session',
    {
      description: 'Register a session you start yourself (for example a helper-agent developer). You become its parent. Returns its roster id.',
      inputSchema: {
        role: z.enum(ROLES),
        project: z.string().optional(),
        workstream: z.string().optional(),
        name: z.string().optional(),
        folder: z.string().optional(),
      },
    },
    (a) =>
      guard(() => {
        const parent = me(ctx);
        const projectId = a.project !== undefined ? requireProject(db, a.project).id : parent.project_id;
        const workstreamId =
          a.workstream !== undefined && projectId !== null ? requireWorkstream(db, projectId, a.workstream).id : parent.workstream_id;
        return registerSession(db, { role: a.role, parentId: parent.id, projectId, workstreamId, name: a.name ?? null, folder: a.folder ?? null });
      }),
  );

  server.registerTool('check_in', { description: 'Record that this session is alive and working.', inputSchema: {} }, () =>
    guard(() => checkIn(db, me(ctx).id)),
  );

  server.registerTool(
    'list_sessions',
    { description: 'The session tree: front desk, architects, developers.', inputSchema: { include_stopped: z.boolean().optional() } },
    ({ include_stopped }) => guard(() => sessionTree(db, { includeStopped: include_stopped === true })),
  );

  server.registerTool(
    'create_goal',
    {
      description: 'Create a goal for a project workstream (default main).',
      inputSchema: { project: z.string(), workstream: z.string().optional(), text: z.string().min(1), budget_usd: z.number().nonnegative().optional() },
    },
    (a) =>
      guard(() => {
        const project = requireProject(db, a.project);
        const workstream = requireWorkstream(db, project.id, a.workstream ?? 'main');
        return createGoal(db, { workstreamId: workstream.id, text: a.text, budgetUsd: a.budget_usd });
      }),
  );

  server.registerTool(
    'update_goal',
    {
      description: 'Change a goal\'s state, text or budget.',
      inputSchema: { goal_id: z.number().int().positive(), state: z.enum(GOAL_STATES).optional(), text: z.string().optional(), budget_usd: z.number().nonnegative().optional() },
    },
    (a) => guard(() => updateGoal(db, a.goal_id, { state: a.state, text: a.text, budgetUsd: a.budget_usd })),
  );

  server.registerTool(
    'get_goal',
    { description: 'A goal with its project, workstream, spend and items.', inputSchema: { goal_id: z.number().int().positive() } },
    ({ goal_id }) =>
      guard(() => ({ goal: goalWithPlace(db, goal_id), spent_usd: spendForGoal(db, goal_id), items: listItems(db, { goalId: goal_id }) })),
  );

  server.registerTool(
    'raise_item',
    {
      description:
        'Raise a sign-off, question, blocker, done report or note (the text goes in body). Goes to your parent session unless addressed_to is given; an architect under a project manager sends sign-offs and questions straight to the front desk, and the project manager watches. Then SendMessage the returned nudge (and watcher_nudge, if present).',
      inputSchema: {
        kind: z.enum(ITEM_KINDS),
        body: z.string().min(1).describe('The text of the item'),
        goal_id: z.number().int().positive().optional(),
        addressed_to: z.number().int().positive().optional().describe('Roster session id'),
      },
    },
    (a) =>
      guard(() => {
        const item = raiseItem(db, { kind: a.kind, body: a.body, goalId: a.goal_id, raisedBy: ctx.identity.sessionId, addressedTo: a.addressed_to });
        const reply: { item: typeof item; nudge: ReturnType<typeof nudge>; watcher_nudge?: ReturnType<typeof nudge> } = {
          item,
          nudge: nudge(ctx, item.addressed_to, item.id),
        };
        if (item.watched_by !== null) reply.watcher_nudge = nudge(ctx, item.watched_by, item.id);
        return reply;
      }),
  );

  server.registerTool(
    'answer_item',
    {
      description:
        'Record the user\'s answer EXACTLY as the user wrote it (verbatim, unedited). The item goes back to whoever raised it. Then SendMessage the returned nudge; if nudge is null (the raiser is stopped), send nothing and tell the user the note.',
      inputSchema: { item_id: z.number().int().positive(), answer: z.string() },
    },
    (a) =>
      guard(() => {
        const caller = me(ctx);
        const before = requireItem(db, a.item_id);
        if (before.watched_by === caller.id && before.addressed_to !== caller.id) {
          throw new Error(`Item #${before.id} is only watched by you: it is addressed to session #${before.addressed_to}, so you cannot answer it`);
        }
        const item = answerItem(db, a.item_id, a.answer);
        return { item, ...answerReply(db, item), ...(item.watched_by === null ? {} : { watcher_nudge: nudge(ctx, item.watched_by, item.id) }) };
      }),
  );

  server.registerTool(
    'close_item',
    { description: 'Close an item you have acted on.', inputSchema: { item_id: z.number().int().positive() } },
    ({ item_id }) =>
      guard(() => {
        const caller = me(ctx);
        const item = requireItem(db, item_id);
        if (caller.role !== 'front-desk' && item.addressed_to !== caller.id && item.raised_by !== caller.id) {
          throw new Error(`Item #${item_id} is not yours to close: it is addressed to session #${item.addressed_to}${item.watched_by === caller.id ? ' and you only watch it' : ''}`);
        }
        return closeItem(db, item_id);
      }),
  );

  server.registerTool(
    'list_items',
    {
      description: 'List roster items. By default only items addressed to you or watched by you (flagged watching: true) that are not closed.',
      inputSchema: {
        mine_only: z.boolean().optional().describe('Default true'),
        states: z.array(z.enum(ITEM_STATES)).optional().describe('Default open and answered'),
        unseen_only: z.boolean().optional(),
        goal_id: z.number().int().positive().optional(),
      },
    },
    (a) =>
      guard(() => {
        const mine = a.mine_only === false ? undefined : me(ctx).id;
        const items = listItems(db, { involving: mine, states: a.states ?? ['open', 'answered'], unseenOnly: a.unseen_only === true, goalId: a.goal_id });
        return mine === undefined ? items : items.map((item) => (item.watched_by === mine && item.addressed_to !== mine ? { ...item, watching: true } : item));
      }),
  );

  server.registerTool(
    'mark_seen',
    {
      description: 'Mark items as seen: one item_id, or a list in item_ids.',
      inputSchema: { item_ids: z.array(z.number().int().positive()).optional(), item_id: z.number().int().positive().optional() },
    },
    ({ item_ids, item_id }) =>
      guard(() => {
        const ids = [...(item_ids ?? []), ...(item_id === undefined ? [] : [item_id])];
        if (ids.length === 0) throw new Error('Give item_id or item_ids');
        const callerId = me(ctx).id;
        const skipped: number[] = [];
        const marked: number[] = [];
        for (const id of ids) {
          const item = requireItem(db, id);
          // One seen flag per item: a session that only watches it must not hide it from the one it is addressed to.
          if (item.watched_by === callerId && item.addressed_to !== callerId) skipped.push(id);
          else marked.push(id);
        }
        markSeen(db, marked);
        return skipped.length === 0 ? { marked } : { marked, skipped, note: 'Skipped items are addressed to someone else; you only watch them.' };
      }),
  );

  server.registerTool(
    'claim',
    {
      description: 'Claim a shared file (or heavy-job name) in a project before editing it. A refusal names the holder.',
      inputSchema: { path: z.string().min(1), project: z.string().optional().describe('Default: your project') },
    },
    (a) => guard(() => claim(db, projectIdFor(ctx, a.project), a.path, me(ctx).id)),
  );

  server.registerTool(
    'release',
    { description: 'Release a claim you hold.', inputSchema: { path: z.string().min(1), project: z.string().optional() } },
    (a) => guard(() => ({ released: release(db, projectIdFor(ctx, a.project), a.path, me(ctx).id) })),
  );

  server.registerTool(
    'report_spend',
    {
      description: 'Report USD spent since your last report. Over-budget raises an item to the front desk.',
      inputSchema: { usd: z.number().nonnegative(), goal_id: z.number().int().positive().optional(), project: z.string().optional() },
    },
    (a) =>
      guard(() =>
        reportSpend(db, {
          usd: a.usd,
          sessionId: ctx.identity.sessionId,
          goalId: a.goal_id,
          projectId: a.project === undefined ? undefined : requireProject(db, a.project).id,
        }),
      ),
  );

  server.registerTool(
    'status',
    {
      description:
        'Status summary (compact JSON): waiting items first, then per project workstreams, architects (stale?), active goals, open items, spend today. Items waiting for the user are listed once, under waiting_for_user.',
      inputSchema: {},
    },
    () => guard(() => JSON.stringify(statusSummary(db))),
  );

  server.registerTool(
    'launch_architect',
    {
      description: 'Open the architect for a project workstream (default main) in its own Windows Terminal tab, or return the running one.',
      inputSchema: { project: z.string(), workstream: z.string().optional(), goal_id: z.number().int().positive().optional() },
    },
    (a) =>
      guard(() =>
        launchArchitect(ctx.launch, {
          project: a.project,
          workstream: a.workstream,
          goalId: a.goal_id,
          parentId: ctx.identity.sessionId ?? frontDesk(db).id,
        }),
      ),
  );

  server.registerTool(
    'launch_project_manager',
    {
      description:
        "Front desk only: open the project manager for a project in its own Windows Terminal tab (on the project's pm workstream, created if missing; opus; one per project), or return the running one. It launches the project's architects, which then hang under it.",
      inputSchema: { project: z.string(), goal_id: z.number().int().positive().optional().describe("A goal on the project's pm workstream") },
    },
    (a) =>
      guard(() => {
        const caller = me(ctx);
        if (caller.role !== 'front-desk') throw new Error('Only the front desk can launch a project manager');
        return launchProjectManager(ctx.launch, { project: a.project, goalId: a.goal_id, parentId: caller.id });
      }),
  );

  server.registerTool(
    'stop_project_manager',
    {
      description: 'Front desk only: stop the running project manager of a project and, first, every architect and developer under it. Kills their process trees, so the tabs close.',
      inputSchema: { project: z.string() },
    },
    (a) =>
      guard(() => {
        if (me(ctx).role !== 'front-desk') throw new Error('Only the front desk can stop a project manager');
        return stopProjectManager(ctx.launch, { project: a.project });
      }),
  );

  server.registerTool(
    'stop_architect',
    {
      description:
        'Stop an architect and its developer sessions: name its project and workstream (default main), or give its session_id. Kills its process tree, so its tab closes.',
      inputSchema: { project: z.string().optional(), workstream: z.string().optional(), session_id: z.number().int().positive().optional() },
    },
    (a) => guard(() => stopArchitect(ctx.launch, { project: a.project, workstream: a.workstream, sessionId: a.session_id })),
  );

  server.registerTool(
    'launch_developer',
    {
      description:
        'Architects only: open a full developer session in its own tab and git worktree for a long job. Already registered under you. Score the task with complexity and clarity (both 1-5) and it runs on the model they map to; unscored, it runs on the project default.',
      inputSchema: {
        task: z.string().min(1),
        label: z.string().min(1).describe('Short name, used in the tab and worktree name'),
        complexity: z.number().int().min(1).max(5).optional().describe('1 trivial .. 5 hard'),
        clarity: z.number().int().min(1).max(5).optional().describe('1 vague .. 5 fully specified'),
      },
    },
    (a) =>
      guard(() =>
        launchDeveloper(ctx.launch, { architectId: me(ctx).id, task: a.task, label: a.label, complexity: a.complexity, clarity: a.clarity }),
      ),
  );

  server.registerTool(
    'stop_developer',
    { description: 'Stop one of your developer sessions and close its tab.', inputSchema: { session_id: z.number().int().positive() } },
    ({ session_id }) =>
      guard(() => {
        const caller = me(ctx);
        const target = requireSession(db, session_id);
        if (target.role !== 'developer' || (target.parent_id !== caller.id && caller.role !== 'front-desk')) {
          throw new Error(`Session #${session_id} is not one of your developers`);
        }
        return stopSession(ctx.launch, session_id);
      }),
  );

  server.registerTool(
    'set_session_model',
    {
      description:
        "Step a session's model up or down (haiku, sonnet, opus). Front desk: any architect or developer. Architect: only your own developers. Never your own session or the front desk. A running tab is relaunched on the new model with its conversation kept; a stopped one records it for its next launch. Logged in model_usage.",
      inputSchema: { session_id: z.number().int().positive(), model: z.enum(WORK_MODELS) },
    },
    (a) =>
      guard(async () => {
        const caller = me(ctx);
        const target = requireSession(db, a.session_id);
        if (target.role === 'front-desk') throw new Error("Multi-Manager does not change the front desk's model");
        // Relaunching yourself would kill this very call before it could answer.
        if (target.id === caller.id) throw new Error("You cannot change your own session's model: ask the front desk (or your architect)");
        const allowed = caller.role === 'front-desk' || (caller.role === 'architect' && target.role === 'developer' && target.parent_id === caller.id);
        if (!allowed) throw new Error(`Session #${a.session_id} is not yours to change`);
        // Relaunching a live tab onto the model it already runs on would interrupt it for nothing.
        if (target.model === a.model) return { session: target, relaunched: false, resumed: false, warnings: [], note: `already on ${a.model}` };
        const result = await changeSessionModel(ctx.launch, { sessionId: target.id, model: a.model });
        recordModelChange(db, { sessionId: target.id, fromModel: target.model, toModel: a.model, reason: 'set_session_model' });
        return result;
      }),
  );

  server.registerTool(
    'set_project_default_model',
    {
      description: "Front desk only: the model a project's developer tabs run on when a task has no scores (haiku, sonnet or opus); null clears it (then sonnet). Architects and project managers ignore it: they start on opus unless stepped down.",
      inputSchema: { project: z.string(), model: z.enum(WORK_MODELS).nullable() },
    },
    (a) =>
      guard(() => {
        if (me(ctx).role !== 'front-desk') throw new Error("Only the front desk can set a project's default model");
        const project = requireProject(db, a.project);
        setProjectDefaultModel(db, project.id, a.model);
        return { project: project.name, default_model: a.model };
      }),
  );

  server.registerTool(
    'log_model_use',
    {
      description:
        'Architects only: record that you switched your own tab to another model (e.g. `/model fable`) for a stretch of thinking, with a one-line reason. Call it again when you switch back.',
      inputSchema: { to_model: z.string().min(1), reason: z.string().min(1) },
    },
    (a) =>
      guard(() => {
        const caller = me(ctx);
        if (caller.role !== 'architect' && caller.role !== 'project-manager') throw new Error('Only an architect or project manager can log a model pull');
        const change = recordModelChange(db, { sessionId: caller.id, fromModel: caller.model, toModel: a.to_model, reason: a.reason });
        return { logged: change.id, note: 'Fable is expensive: keep these pulls rare and for high-level thinking only.' };
      }),
  );

  server.registerTool(
    'model_usage',
    {
      description: 'Where models were changed: set_session_model steps and Fable pulls, newest first. Optionally for one project.',
      inputSchema: { project: z.string().optional(), limit: z.number().int().positive().max(100).optional() },
    },
    (a) =>
      guard(() => listModelUsage(db, { projectId: a.project === undefined ? undefined : requireProject(db, a.project).id, limit: a.limit })),
  );

  registerPauseTools(server, ctx);
  registerMonitorTools(server, ctx);
  registerHealthTools(server, ctx);
  registerVoiceTools(server, ctx);
  registerRecoveryTools(server, ctx);
  registerTidyTools(server, ctx);
}
