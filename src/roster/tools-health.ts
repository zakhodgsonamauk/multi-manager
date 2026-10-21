import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { launchDeveloper, stopSession } from '../launch/launcher.ts';
import { realActivityReaders, type ActivityReaders } from '../monitor/activity.ts';
import { RESTART_LINE, closeHealthItems, recordNudge, sessionHealth, unresolvedDeaths, type SessionHealth } from '../monitor/health.ts';
import { assertNotPaused, isPaused } from './pause.ts';
import { getSessionTask, saveSessionTask } from './session-tasks.ts';
import { many } from './db.ts';
import { requireSession, type Session } from './sessions.ts';
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

type HealthRow = Pick<SessionHealth, 'session_id' | 'name' | 'role' | 'state' | 'status' | 'minutes_quiet' | 'nudges' | 'recommended_action' | 'reason'>;

function row(h: SessionHealth): HealthRow {
  const { session_id, name, role, state, status, minutes_quiet, nudges, recommended_action, reason } = h;
  return { session_id, name, role, state, status, minutes_quiet, nudges, recommended_action, reason };
}

export interface HealthToolOptions {
  readers?: ActivityReaders;
  now?: () => number;
}

/** team_health, record_nudge and restart_developer: the stuck-session ladder (nudge, nudge, restart or report). */
export function registerHealthTools(server: McpServer, ctx: ToolContext, options: HealthToolOptions = {}): void {
  const { db } = ctx;
  const readers = options.readers ?? realActivityReaders();
  const now = options.now ?? (() => Date.now());

  /** Running children of a role plus the dead ones nobody has dealt with yet. */
  const scope = (filter: (s: Session) => boolean): Session[] => {
    const dead = unresolvedDeaths(db).filter(filter);
    const running = many<Session>(db.prepare("SELECT * FROM sessions WHERE state = 'running' AND role IN ('architect', 'developer') ORDER BY id").all());
    return [...running.filter(filter), ...dead].sort((a, b) => a.id - b.id);
  };

  /** Who may act on a session: its parent architect, or the front desk for anything. */
  const assertMayAct = (caller: Session, target: Session): void => {
    if (caller.role === 'front-desk') return;
    if (caller.role === 'architect' && target.parent_id === caller.id) return;
    throw new Error(`Session #${target.id} is not one of yours`);
  };

  server.registerTool(
    'team_health',
    {
      description:
        'Stuck check. Architect: your developers. Front desk: every architect, with its developers summarised. Each session: state (ok, hung, stalled, dead), status (busy, idle, unknown), minutes_quiet, nudges since its last activity, and recommended_action (none, nudge, restart, report). paused is true if your scope is paused.',
      inputSchema: {},
    },
    () =>
      guard(() => {
        const caller = me(ctx);
        const t = now();
        if (caller.role === 'architect') {
          const sessions = scope((s) => s.role === 'developer' && s.parent_id === caller.id).map((s) => row(sessionHealth(db, s, readers, t)));
          return { paused: isPaused(db, caller.project_id), sessions };
        }
        if (caller.role !== 'front-desk') throw new Error('Only architects and the front desk can call team_health');
        const sessions = scope((s) => s.role === 'architect').map((s) => {
          const devs = scope((d) => d.role === 'developer' && d.parent_id === s.id).map((d) => sessionHealth(db, d, readers, t));
          const names = (state: string) => devs.filter((d) => d.state === state).map((d) => d.name);
          return {
            ...row(sessionHealth(db, s, readers, t)),
            developers: { total: devs.length, ok: names('ok').length, hung: names('hung'), stalled: names('stalled'), dead: names('dead') },
          };
        });
        return { paused: isPaused(db), sessions };
      }),
  );

  server.registerTool(
    'record_nudge',
    {
      description: 'Record that you nudged a stuck session (call it when you SendMessage the nudge). Returns its nudge count since its last activity.',
      inputSchema: { session_id: z.number().int().positive() },
    },
    ({ session_id }) =>
      guard(() => {
        const target = requireSession(db, session_id);
        assertMayAct(me(ctx), target);
        if (target.role === 'front-desk') throw new Error('The front desk is not nudged');
        const health = sessionHealth(db, target, readers, now());
        return { session_id, name: health.name, nudges: recordNudge(db, session_id, health.last_activity_ms, now()) };
      }),
  );

  server.registerTool(
    'restart_developer',
    {
      description:
        'Architect only, for your own developer after two nudges (or when it died): stops it and relaunches it with its original task in the same worktree, told to check its branch for earlier work. Refused while paused. Returns the new session.',
      inputSchema: { session_id: z.number().int().positive() },
    },
    ({ session_id }) =>
      guard(async () => {
        const caller = me(ctx);
        const target = requireSession(db, session_id);
        if (caller.role !== 'architect') throw new Error('Only an architect can restart its developers');
        if (target.role !== 'developer' || target.parent_id !== caller.id) throw new Error(`Session #${session_id} is not one of your developers`);
        assertNotPaused(db, target.project_id);
        const stored = getSessionTask(db, session_id);
        if (stored === undefined) throw new Error(`No stored task for session #${session_id}. Launch a new developer with launch_developer instead.`);
        const stopped = await stopSession(ctx.launch, session_id);
        closeHealthItems(db, session_id);
        const result = await launchDeveloper(ctx.launch, { architectId: caller.id, task: `${stored.task} ${RESTART_LINE}`, label: stored.label });
        // Keep the original task, so a second restart does not repeat the restart line.
        saveSessionTask(db, result.session.id, stored.label, stored.task);
        return { session: result.session, replaced_session_id: session_id, warnings: [...stopped.warnings, ...result.warnings] };
      }),
  );
}
