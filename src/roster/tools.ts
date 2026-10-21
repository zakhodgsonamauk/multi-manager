import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { sessionIdFromEnv } from '../hooks/common.ts';
import { launchArchitect, launchDeveloper, permissionWarning, stopArchitect, stopSession, type LaunchContext } from '../launch/launcher.ts';
import { claim, release } from './claims.ts';
import type { Env } from './db.ts';
import { GOAL_STATES, createGoal, goalWithPlace, updateGoal } from './goals.ts';
import { ITEM_KINDS, ITEM_STATES, answerItem, closeItem, listItems, markSeen, raiseItem } from './items.ts';
import { addProject, addWorkstream, listProjects, listWorkstreams, requireProject, requireWorkstream } from './projects.ts';
import {
  FRONT_DESK_NAME,
  ROLES,
  checkIn,
  frontDesk,
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
import { registerMonitorTools } from './tools-monitor.ts';

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

function me(ctx: ToolContext): Session {
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

export function registerRosterTools(server: McpServer, ctx: ToolContext): void {
  const { db } = ctx;

  server.registerTool(
    'start_front_desk',
    {
      description:
        'Make this session the Multi-Manager front desk (reuses the single front-desk record), install the Windows Terminal profile, and return the front-desk briefing plus the status with waiting items first.',
      inputSchema: { name: z.string().optional().describe('This session\'s -n name; default mm-front-desk') },
    },
    ({ name }) =>
      guard(() => {
        const desk = startFrontDesk(db, name ?? FRONT_DESK_NAME);
        ctx.identity = { sessionId: desk.id, role: 'front-desk' };
        ctx.launch.deps.ensureTerminalProfile();
        return [
          briefing(ctx.pluginRoot, 'front-desk').text,
          `## You are roster session #${desk.id} (${desk.name ?? FRONT_DESK_NAME})`,
          '## Status (waiting items first)',
          JSON.stringify(statusSummary(db), null, 2),
        ].join('\n\n');
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
        workstreams: z.array(z.object({ name: z.string().min(1), branch: z.string().min(1) })).optional(),
      },
    },
    (a) =>
      guard(() => {
        const project = addProject(db, {
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

  server.registerTool('list_projects', { description: 'List all projects with their settings.', inputSchema: {} }, () =>
    guard(() => listProjects(db)),
  );

  server.registerTool(
    'add_workstream',
    { description: 'Add a workstream (name and branch) to a project.', inputSchema: { project: z.string(), name: z.string().min(1), branch: z.string().min(1) } },
    (a) => guard(() => addWorkstream(db, a.project, { name: a.name, branch: a.branch })),
  );

  server.registerTool(
    'list_workstreams',
    { description: 'List the workstreams of a project.', inputSchema: { project: z.string() } },
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
        'Raise a sign-off, question, blocker, done report or note. Goes to your parent session (architects: the front desk) unless addressed_to is given. Then SendMessage the returned nudge.',
      inputSchema: {
        kind: z.enum(ITEM_KINDS),
        body: z.string().min(1),
        goal_id: z.number().int().positive().optional(),
        addressed_to: z.number().int().positive().optional().describe('Roster session id'),
      },
    },
    (a) =>
      guard(() => {
        const item = raiseItem(db, { kind: a.kind, body: a.body, goalId: a.goal_id, raisedBy: ctx.identity.sessionId, addressedTo: a.addressed_to });
        return { item, nudge: nudge(ctx, item.addressed_to, item.id) };
      }),
  );

  server.registerTool(
    'answer_item',
    {
      description: 'Record the user\'s answer EXACTLY as the user wrote it (verbatim, unedited). The item goes back to whoever raised it. Then SendMessage the returned nudge.',
      inputSchema: { item_id: z.number().int().positive(), answer: z.string() },
    },
    (a) =>
      guard(() => {
        const item = answerItem(db, a.item_id, a.answer);
        return { item, nudge: nudge(ctx, item.addressed_to, item.id) };
      }),
  );

  server.registerTool(
    'close_item',
    { description: 'Close an item you have acted on.', inputSchema: { item_id: z.number().int().positive() } },
    ({ item_id }) => guard(() => closeItem(db, item_id)),
  );

  server.registerTool(
    'list_items',
    {
      description: 'List roster items. By default only items addressed to you that are not closed.',
      inputSchema: {
        mine_only: z.boolean().optional().describe('Default true'),
        states: z.array(z.enum(ITEM_STATES)).optional().describe('Default open and answered'),
        unseen_only: z.boolean().optional(),
        goal_id: z.number().int().positive().optional(),
      },
    },
    (a) =>
      guard(() =>
        listItems(db, {
          addressedTo: a.mine_only === false ? undefined : me(ctx).id,
          states: a.states ?? ['open', 'answered'],
          unseenOnly: a.unseen_only === true,
          goalId: a.goal_id,
        }),
      ),
  );

  server.registerTool(
    'mark_seen',
    { description: 'Mark items as seen.', inputSchema: { item_ids: z.array(z.number().int().positive()) } },
    ({ item_ids }) =>
      guard(() => {
        markSeen(db, item_ids);
        return { marked: item_ids };
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
    { description: 'Status summary: waiting items first, then per project workstreams, architects (stale?), active goals, open items, spend today.', inputSchema: {} },
    () => guard(() => statusSummary(db)),
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
    'stop_architect',
    {
      description: 'Stop the architect for a project workstream (default main) and its developer sessions. Kills its process tree, so its tab closes.',
      inputSchema: { project: z.string(), workstream: z.string().optional() },
    },
    (a) => guard(() => stopArchitect(ctx.launch, { project: a.project, workstream: a.workstream })),
  );

  server.registerTool(
    'launch_developer',
    {
      description: 'Architects only: open a full developer session in its own tab and git worktree for a long job. Already registered under you.',
      inputSchema: { task: z.string().min(1), label: z.string().min(1).describe('Short name, used in the tab and worktree name') },
    },
    (a) => guard(() => launchDeveloper(ctx.launch, { architectId: me(ctx).id, task: a.task, label: a.label })),
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

  registerMonitorTools(server, ctx);
}
