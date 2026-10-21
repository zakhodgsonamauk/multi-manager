import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { resourceReport } from '../monitor/enforce.ts';
import { monitoredSessions, realMonitorDeps, runTick, type MonitorDeps } from '../monitor/monitor.ts';
import { allocateNumber } from './counters.ts';
import { getLimits, getStallMinutes, listLimits, setLimits } from './limits.ts';
import { listProjects, requireProject, requireProjectById } from './projects.ts';
import { getSession } from './sessions.ts';
import type { ToolContext } from './tools.ts';

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

function callerProjectId(ctx: ToolContext): number | null {
  const id = ctx.identity.sessionId;
  return id === null ? null : (getSession(ctx.db, id)?.project_id ?? null);
}

function projectIdFor(ctx: ToolContext, project: string | undefined): number {
  if (project !== undefined) return requireProject(ctx.db, project).id;
  const id = callerProjectId(ctx);
  if (id === null) throw new Error('Name the project: this session has none');
  return id;
}

const caps = z.record(z.string().min(1), z.number().int().nonnegative());

function named(ctx: ToolContext, limits: ReturnType<typeof getLimits>) {
  return { project: requireProjectById(ctx.db, limits.project_id).name, ...limits, stall_minutes: getStallMinutes(ctx.db, limits.project_id) };
}

/** Process limits, number allocation and the monitor. `deps` defaults to the real process snapshot and taskkill. */
export function registerMonitorTools(server: McpServer, ctx: ToolContext, deps: MonitorDeps = realMonitorDeps()): void {
  const { db } = ctx;

  server.registerTool(
    'set_limits',
    {
      description:
        'Front desk or the project\'s architect: set ENFORCED process limits for a project. The monitor kills the newest excess processes (whole subtree) inside the offending session and tells its parent. A caps map replaces the old map; omit a field to keep it.',
      inputSchema: {
        project: z.string().optional().describe('Default: your project'),
        max_processes_per_session: z.number().int().nonnegative().nullable().optional().describe('null removes the cap'),
        session_binary_caps: caps.optional().describe('Per session, e.g. {"godot.exe": 2}; "*" wildcards allowed'),
        machine_binary_caps: caps.optional().describe('Across all Multi-Manager sessions, e.g. {"godot.exe": 6}'),
        stall_minutes: z.number().int().positive().nullable().optional().describe('Minutes without activity before a session counts as stuck (default 20); null resets'),
      },
    },
    (a) =>
      guard(() => {
        const role = ctx.identity.role;
        const projectId = projectIdFor(ctx, a.project);
        if (role !== 'front-desk' && !(role === 'architect' && callerProjectId(ctx) === projectId)) {
          throw new Error('Only the front desk or this project\'s architect may set its limits');
        }
        return named(
          ctx,
          setLimits(db, projectId, {
            maxProcessesPerSession: a.max_processes_per_session,
            sessionBinaryCaps: a.session_binary_caps,
            machineBinaryCaps: a.machine_binary_caps,
            stallMinutes: a.stall_minutes,
          }),
        );
      }),
  );

  server.registerTool(
    'get_limits',
    { description: 'The enforced process limits of one project, or of every project.', inputSchema: { project: z.string().optional() } },
    ({ project }) =>
      guard(() => {
        if (project !== undefined) return named(ctx, getLimits(db, requireProject(db, project).id));
        const set = new Map(listLimits(db).map((l) => [l.project_id, l]));
        return listProjects(db).map((p) => named(ctx, set.get(p.id) ?? getLimits(db, p.id)));
      }),
  );

  server.registerTool(
    'allocate_number',
    {
      description:
        'Get the next unique number of a kind (task, finding, …) for a project. Use it for every shared number so sessions never clash. at_least seeds from numbers already used.',
      inputSchema: {
        kind: z.string().min(1),
        project: z.string().optional().describe('Default: your project'),
        at_least: z.number().int().optional().describe('The number returned is never below this'),
      },
    },
    (a) =>
      guard(() => {
        const projectId = projectIdFor(ctx, a.project);
        return { project: requireProjectById(db, projectId).name, kind: a.kind.trim(), number: allocateNumber(db, projectId, a.kind, { atLeast: a.at_least }) };
      }),
  );

  server.registerTool(
    'resources',
    {
      description: 'Per running session: process count, named-binary counts, the caps that apply, and whether it is over.',
      inputSchema: { project: z.string().optional().describe('Default: all projects') },
    },
    ({ project }) =>
      guard(async () => {
        const projectId = project === undefined ? undefined : requireProject(db, project).id;
        const sessions = monitoredSessions(db).filter((s) => projectId === undefined || s.project_id === projectId);
        return resourceReport(await deps.snapshot(), sessions, listLimits(db));
      }),
  );

  server.registerTool(
    'monitor_tick',
    {
      description: 'Run one monitor pass now: mark dead sessions stopped (raising an item each) and enforce process limits. Returns what happened.',
      inputSchema: {},
    },
    () => guard(() => runTick(db, deps)),
  );
}
