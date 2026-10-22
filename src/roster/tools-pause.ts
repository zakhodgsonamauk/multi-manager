import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { launchArchitect, stopSession } from '../launch/launcher.ts';
import { raiseItem } from './items.ts';
import {
  PAUSE_ITEM_TEXT,
  activePauseFor,
  endPause,
  isPaused,
  pauseReports,
  reportPaused,
  requirePause,
  runningInScope,
  startPause,
  type Pause,
} from './pause.ts';
import { requireProject, requireProjectById, requireWorkstreamById } from './projects.ts';
import { frontDesk, getSession, requireSession, type Session } from './sessions.ts';
import type { ToolContext } from './tools.ts';

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

function me(ctx: ToolContext): Session {
  if (ctx.identity.sessionId === null) throw new Error('This session is not registered with the roster');
  return requireSession(ctx.db, ctx.identity.sessionId);
}

function frontDeskOnly(ctx: ToolContext, tool: string): Session {
  const caller = me(ctx);
  if (caller.role !== 'front-desk') throw new Error(`Only the front desk can call ${tool}`);
  return caller;
}

const label = (s: Session): string => s.name ?? `session #${s.id}`;

/** The pause a front-desk tool acts on: by id, or the active pause with exactly the given scope. */
function targetPause(ctx: ToolContext, input: { pause_id?: number; project?: string }): Pause {
  if (input.pause_id !== undefined) return requirePause(ctx.db, input.pause_id);
  const projectId = input.project === undefined ? null : requireProject(ctx.db, input.project).id;
  const pause = activePauseFor(ctx.db, projectId);
  if (pause === undefined) throw new Error(`No active pause for ${input.project ?? 'everything'}`);
  return pause;
}

function status(ctx: ToolContext, pause: Pause) {
  const sessions = pauseReports(ctx.db, pause.id).map((r) => {
    const s = requireSession(ctx.db, r.session_id);
    return {
      session_id: s.id,
      name: label(s),
      role: r.role,
      state: s.state,
      reported: r.reported_at !== null,
      committed: r.committed === null ? null : r.committed === 1,
      note_path: r.note_path,
      summary: r.summary,
    };
  });
  return {
    pause: { ...pause, scope: pause.project_id === null ? 'everything' : requireProjectById(ctx.db, pause.project_id).name },
    sessions,
    not_reported: sessions.filter((s) => !s.reported).map((s) => s.name),
    still_running: runningInScope(ctx.db, pause.project_id).map(label),
  };
}

/** A prompt-safe one-liner: Windows Terminal splits commands on ';'. */
const oneLine = (text: string): string => text.replace(/[;\r\n]+/g, ', ');

export function registerPauseTools(server: McpServer, ctx: ToolContext): void {
  const { db } = ctx;
  const scope = {
    pause_id: z.number().int().positive().optional(),
    project: z.string().optional().describe('Default: the whole-roster pause'),
  };

  server.registerTool(
    'pause',
    {
      description:
        'Front desk only. Pause one project or everything: nothing launches while paused. Raises a PAUSE item to every running session in scope; then SendMessage each returned session its nudge.',
      inputSchema: { project: z.string().optional().describe('Omit to pause everything'), reason: z.string().optional() },
    },
    (a) =>
      guard(() => {
        const desk = frontDeskOnly(ctx, 'pause');
        const projectId = a.project === undefined ? null : requireProject(db, a.project).id;
        const { pause, sessions } = startPause(db, { projectId, reason: a.reason });
        return {
          pause,
          sessions: sessions.map((s) => {
            const item = raiseItem(db, { kind: 'info', body: `${PAUSE_ITEM_TEXT} (pause #${pause.id}).`, raisedBy: desk.id, addressedTo: s.id });
            return { session_id: s.id, name: label(s), role: s.role, item_id: item.id, nudge: `check roster item #${item.id}` };
          }),
        };
      }),
  );

  server.registerTool(
    'report_paused',
    {
      description: 'Report that you reached a clean point for the pause: where your resume note is, a short summary, and whether WIP is committed on your branch.',
      inputSchema: {
        note_path: z.string().min(1).describe('Resume note path (your progress log)'),
        summary: z.string().min(1).describe('One or two lines: where you stopped and what is next'),
        committed: z.boolean().describe('WIP committed on your own branch?'),
      },
    },
    (a) =>
      guard(() => {
        const reports = reportPaused(db, me(ctx), { notePath: a.note_path, summary: a.summary, committed: a.committed });
        return { reports, nudge: { to: frontDesk(db).name, message: 'pause report in: check pause_status' }, next: 'Stop now. Start nothing new.' };
      }),
  );

  server.registerTool(
    'pause_status',
    { description: 'Which sessions in a pause have reported (note, summary, committed) and which have not, and what is still running.', inputSchema: scope },
    (a) => guard(() => status(ctx, targetPause(ctx, a))),
  );

  server.registerTool(
    'finish_pause',
    {
      description:
        'Front desk only. Close every running session in the pause scope, then confirm what is still running. Refuses until every session has reported, unless force is true.',
      inputSchema: { ...scope, force: z.boolean().optional() },
    },
    (a) =>
      guard(async () => {
        frontDeskOnly(ctx, 'finish_pause');
        const pause = targetPause(ctx, a);
        if (pause.ended_at !== null) throw new Error(`Pause #${pause.id} has already ended`);
        const before = status(ctx, pause);
        if (before.not_reported.length > 0 && a.force !== true) {
          throw new Error(`Not reported yet: ${before.not_reported.join(', ')}. Nudge them, or pass force: true to close them anyway.`);
        }
        const targets = runningInScope(db, pause.project_id);
        const warnings: string[] = [];
        // Architects first: stopSession closes their developers before them.
        for (const role of ['architect', 'developer'] as const) {
          for (const s of targets) {
            if (s.role !== role || requireSession(db, s.id).state !== 'running') continue;
            warnings.push(...(await stopSession(ctx.launch, s.id)).warnings);
          }
        }
        // Belt and braces: a stopped session whose claude.exe is still ours and alive is still running.
        const alive: string[] = [];
        for (const s of targets.map((t) => requireSession(db, t.id))) {
          if (s.pid !== null && s.name !== null && (await ctx.launch.deps.ownsProcess(s.pid, s.name))) alive.push(`${s.name} (pid ${s.pid})`);
        }
        const stillRunning = [...runningInScope(db, pause.project_id).map(label), ...alive];
        return {
          ...status(ctx, pause),
          stopped: targets.map(label),
          warnings,
          still_running: stillRunning,
          confirmation: stillRunning.length === 0 ? 'Nothing left running.' : `Still running: ${stillRunning.join(', ')}`,
        };
      }),
  );

  server.registerTool(
    'resume',
    {
      description:
        'Front desk only, after the user says go. Ends the pause and relaunches the architects that were running at pause time, pointed at their resume notes. They summarise and WAIT for the user\'s go. Developers are not relaunched.',
      inputSchema: scope,
    },
    (a) =>
      guard(async () => {
        const desk = frontDeskOnly(ctx, 'resume');
        const pause = targetPause(ctx, a);
        if (pause.ended_at !== null) throw new Error(`Pause #${pause.id} has already ended`);
        const reports = pauseReports(db, pause.id);
        const ended = endPause(db, pause.id);
        const architects: { name: string; session_id?: number; relaunched: boolean; nudge?: string; note?: string }[] = [];
        for (const r of reports.filter((x) => x.role === 'architect')) {
          const old = requireSession(db, r.session_id);
          if (old.project_id === null || old.workstream_id === null) continue;
          const project = requireProjectById(db, old.project_id);
          if (isPaused(db, project.id)) {
            architects.push({ name: label(old), relaunched: false, note: `${project.name} is still under another pause` });
            continue;
          }
          const where = r.note_path === null ? 'No resume note was reported: read your progress log' : `Your resume note: ${r.note_path}`;
          const text = oneLine(
            `RESUME after pause #${pause.id}. ${where}. Summarise status to the front desk and WAIT for the user's go before starting work. Do not relaunch developers until then.`,
          );
          const result = await launchArchitect(ctx.launch, {
            project: project.name,
            workstream: requireWorkstreamById(db, old.workstream_id).name,
            parentId: desk.id,
            extraPrompt: text,
            model: old.model ?? undefined,
          });
          if (result.existing) {
            const item = raiseItem(db, { kind: 'info', body: text, raisedBy: desk.id, addressedTo: result.session.id });
            architects.push({ name: label(result.session), session_id: result.session.id, relaunched: false, nudge: `check roster item #${item.id}` });
          } else {
            architects.push({ name: label(result.session), session_id: result.session.id, relaunched: true });
          }
        }
        const developers = reports
          .filter((r) => r.role === 'developer')
          .map((r) => ({ name: label(getSession(db, r.session_id)!), note_path: r.note_path, committed: r.committed === 1 }));
        return {
          pause: ended,
          architects,
          developers_not_relaunched: developers,
          next: 'Architects will summarise and wait. Nothing starts until the user says go.',
        };
      }),
  );
}
