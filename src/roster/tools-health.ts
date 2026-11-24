import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { launchDeveloper, stopSession } from '../launch/launcher.ts';
import { realActivityReaders, type ActivityReaders } from '../monitor/activity.ts';
import { lifecycleRow, markNoteReady, refreshRequestLive } from '../monitor/lifecycle.ts';
import { RESTART_LINE, closeHealthItems, recordNudge, sessionHealth, unresolvedDeaths, type SessionHealth } from '../monitor/health.ts';
import { assertNotPaused, isPaused } from './pause.ts';
import { getSessionTask, saveSessionTask } from './session-tasks.ts';
import { many, one } from './db.ts';
import { itemCategory, type ItemKind } from './items.ts';
import { requireSession, type Session } from './sessions.ts';
import { currentIdentity, type ToolContext } from './tools.ts';

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

function me(ctx: ToolContext): Session {
  const id = currentIdentity(ctx).sessionId;
  if (id === null) throw new Error('This session is not registered with the roster');
  return requireSession(ctx.db, id);
}

const REFRESH_MESSAGE =
  'Your conversation is big, so you will be restarted fresh. Write your resume note to progress.md (where you stopped, what is in flight, next step), update status.md, then call resume_note_written and stop.';

type HealthRow =Pick<SessionHealth, 'session_id' | 'name' | 'role' | 'state' | 'status' | 'minutes_quiet' | 'nudges' | 'recommended_action' | 'reason'>;

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
    const running = many<Session>(db.prepare("SELECT * FROM sessions WHERE state = 'running' AND role IN ('architect', 'project-manager', 'developer') ORDER BY id").all());
    return [...running.filter(filter), ...dead].sort((a, b) => a.id - b.id);
  };

  /** Who may act on a session: its parent architect, or the front desk for anything. */
  const assertMayAct = (caller: Session, target: Session): void => {
    if (caller.role === 'front-desk') return;
    if ((caller.role === 'architect' || caller.role === 'project-manager') && target.parent_id === caller.id) return;
    throw new Error(`Session #${target.id} is not one of yours`);
  };

  server.registerTool(
    'team_health',
    {
      description:
        'Stuck check. Architect: your developers. Project manager: your architects, each with its developers summarised. Front desk: each project manager with its architects nested, then every architect without one, developers summarised. Each session: state (ok, hung, stalled, dead), status (busy, idle, unknown), minutes_quiet, nudges since its last activity, and recommended_action (none, nudge, restart, report). paused is true if your scope is paused.',
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
        if (caller.role !== 'front-desk' && caller.role !== 'project-manager') {
          throw new Error('Only architects and the front desk (and project managers) can call team_health');
        }
        // A project manager sees its own architects; the front desk sees each project manager with its architects
        // nested, then every architect no project manager manages.
        const withDevelopers = (s: Session) => {
          const devs = scope((d) => d.role === 'developer' && d.parent_id === s.id).map((d) => sessionHealth(db, d, readers, t));
          const names = (state: string) => devs.filter((d) => d.state === state).map((d) => d.name);
          return {
            ...row(sessionHealth(db, s, readers, t)),
            developers: { total: devs.length, ok: names('ok').length, hung: names('hung'), stalled: names('stalled'), dead: names('dead') },
          };
        };
        if (caller.role === 'project-manager') {
          const sessions = scope((s) => s.role === 'architect' && s.parent_id === caller.id).map(withDevelopers);
          return { paused: isPaused(db), sessions };
        }
        const all = scope((s) => s.role === 'architect' || s.role === 'project-manager');
        const managers = new Set(all.filter((s) => s.role === 'project-manager').map((s) => s.id));
        const sessions = all
          .filter((s) => s.role === 'project-manager' || s.parent_id === null || !managers.has(s.parent_id))
          .map((s) =>
            s.role === 'project-manager'
              ? { ...row(sessionHealth(db, s, readers, t)), architects: all.filter((a) => a.role === 'architect' && a.parent_id === s.id).map(withDevelopers) }
              : withDevelopers(s),
          );
        return { paused: isPaused(db), sessions };
      }),
  );

  server.registerTool(
    'front_desk_digest',
    {
      description:
        'Front desk only: does anything need you right now? Compact JSON: quiet (true when nothing below is non-empty), paused, act_on (sessions team_health recommends acting on), idle_past_limit (architects idle past the idle_stop_minutes of their project with no live goal), refresh_due (managers with a conversation past their limit: SendMessage each its `message` once, then leave it to restart itself), new_items (open items for the front desk that are not marked seen yet, raised since the optional ISO time `since`; items already marked seen are left out) and a fingerprint that stays the same while nothing changes.',
      inputSchema: { since: z.string().optional().describe('ISO time; only items raised after it are listed') },
    },
    ({ since }) =>
      guard(() => {
        const caller = me(ctx);
        if (caller.role !== 'front-desk') throw new Error('Only the front desk can call front_desk_digest');
        const t = now();
        let sinceIso: string | null = null;
        if (since !== undefined) {
          const parsed = Date.parse(since);
          if (!Number.isFinite(parsed)) throw new Error(`since must be an ISO time, got "${since}"`);
          sinceIso = new Date(parsed).toISOString();
        }
        // Same sessions and same health logic as the front desk's team_health: architects and project managers.
        const top = scope((s) => s.role === 'architect' || s.role === 'project-manager').map((s) => ({ session: s, health: sessionHealth(db, s, readers, t) }));
        const act_on = top
          .filter(({ health }) => health.recommended_action !== 'none')
          .map(({ health: h }) => ({ id: h.session_id, name: h.name, role: h.role, state: h.state, action: h.recommended_action, nudges: h.nudges, reason: h.reason }));
        const idle_past_limit = top
          .filter(({ session, health }) => {
            if (session.role !== 'architect' || session.state !== 'running' || health.status !== 'idle') return false;
            const limit = one<{ idle_stop_minutes: number }>(db.prepare('SELECT idle_stop_minutes FROM projects WHERE id = ?').get(session.project_id ?? -1));
            if (limit === undefined || health.minutes_quiet <= limit.idle_stop_minutes) return false;
            const live = one(
              db
                .prepare("SELECT 1 AS x FROM goals WHERE workstream_id = ? AND state IN ('new', 'planning', 'awaiting-signoff', 'in-progress') LIMIT 1")
                .get(session.workstream_id ?? -1),
            );
            return live === undefined;
          })
          .map(({ health: h }) => ({ id: h.session_id, name: h.name, idle_minutes: h.minutes_quiet }));
        // Managers whose conversation grew past their project's limit: the monitor will restart them fresh once they have written their note.
        const refresh_due = top
          .filter(({ session }) => {
            const row = lifecycleRow(db, session.id);
            return session.state === 'running' && refreshRequestLive(row, t);
          })
          .map(({ health: h }) => ({
            id: h.session_id,
            name: h.name,
            message: REFRESH_MESSAGE,
          }));
        const rows = many<{ id: number; kind: ItemKind; body: string; project: string | null; raised_by: string | null }>(
          db
            .prepare(
              `SELECT i.id, i.kind, i.body, COALESCE(p.name, rp.name) AS project, r.name AS raised_by
               FROM items i
               LEFT JOIN goals g ON g.id = i.goal_id
               LEFT JOIN workstreams w ON w.id = g.workstream_id
               LEFT JOIN projects p ON p.id = w.project_id
               LEFT JOIN sessions r ON r.id = i.raised_by
               LEFT JOIN projects rp ON rp.id = r.project_id
               WHERE i.state = 'open' AND i.seen = 0 AND i.addressed_to = ? AND (? IS NULL OR i.created_at > ?) ORDER BY i.id`,
            )
            .all(caller.id, sinceIso, sinceIso),
        );
        const new_items = rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          category: itemCategory(r.kind),
          project: r.project,
          raised_by: r.raised_by,
          body: r.body.length > 200 ? `${r.body.slice(0, 199)}…` : r.body,
        }));
        const fingerprint = createHash('sha1')
          .update([...act_on.map((a) => `a${a.id}:${a.action}:${a.nudges}`), ...idle_past_limit.map((i) => `i${i.id}`), ...refresh_due.map((r) => `r${r.id}`), ...new_items.map((i) => `n${i.id}`)].join('|'))
          .digest('hex')
          .slice(0, 8);
        const quiet = act_on.length === 0 && idle_past_limit.length === 0 && refresh_due.length === 0 && new_items.length === 0;
        // Compact on purpose: a quiet answer is about 120 characters.
        return JSON.stringify({ quiet, paused: isPaused(db), act_on, idle_past_limit, ...(refresh_due.length > 0 ? { refresh_due } : {}), new_items, fingerprint });
      }),
  );

  server.registerTool(
    'manager_digest',
    {
      description:
        'Architect or project manager only: does anything need you right now? Same compact JSON as front_desk_digest, for your own scope: act_on (architect: your developers; project manager: your architects, as team_health recommends), refresh_due (yourself, when your conversation is big: write your resume note, then call resume_note_written), new_items (live items addressed to you and not marked seen, plus items you only watch raised since the optional ISO time `since`), quiet, paused and a fingerprint that stays the same while nothing changes. The Multi-Manager panel calls this for you and starts a check-in turn only when quiet is false.',
      inputSchema: { since: z.string().optional().describe('ISO time; items you only watch are listed only if raised after it') },
    },
    ({ since }) =>
      guard(() => {
        const caller = me(ctx);
        if (caller.role !== 'architect' && caller.role !== 'project-manager') throw new Error('Only architects and project managers can call manager_digest');
        const t = now();
        let sinceIso: string | null = null;
        if (since !== undefined) {
          const parsed = Date.parse(since);
          if (!Number.isFinite(parsed)) throw new Error(`since must be an ISO time, got "${since}"`);
          sinceIso = new Date(parsed).toISOString();
        }
        const childRole = caller.role === 'architect' ? 'developer' : 'architect';
        const act_on = scope((s) => s.role === childRole && s.parent_id === caller.id)
          .map((s) => sessionHealth(db, s, readers, t))
          .filter((h) => h.recommended_action !== 'none')
          .map((h) => ({ id: h.session_id, name: h.name, role: h.role, state: h.state, action: h.recommended_action, nudges: h.nudges, reason: h.reason }));
        const refresh_due =
          caller.state === 'running' && refreshRequestLive(lifecycleRow(db, caller.id), t)
            ? [{ id: caller.id, name: caller.name, message: REFRESH_MESSAGE }]
            : [];
        // Addressed to me: unread until the Stop hook shows it (or mark_seen). Only watched: the seen flag is not mine to set,
        // so those are listed once, by time.
        const rows = many<{ id: number; kind: ItemKind; body: string; raised_by: string | null }>(
          db
            .prepare(
              `SELECT i.id, i.kind, i.body, r.name AS raised_by
               FROM items i LEFT JOIN sessions r ON r.id = i.raised_by
               WHERE (i.addressed_to = ? AND i.seen = 0 AND i.state IN ('open', 'answered'))
                  OR (i.watched_by = ? AND i.addressed_to <> ? AND i.state = 'open' AND (? IS NULL OR i.created_at > ?))
               ORDER BY i.id`,
            )
            .all(caller.id, caller.id, caller.id, sinceIso, sinceIso),
        );
        const new_items = rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          category: itemCategory(r.kind),
          raised_by: r.raised_by,
          body: r.body.length > 200 ? `${r.body.slice(0, 199)}…` : r.body,
        }));
        const fingerprint = createHash('sha1')
          .update([...act_on.map((a) => `a${a.id}:${a.action}:${a.nudges}`), ...refresh_due.map((r) => `r${r.id}`), ...new_items.map((i) => `n${i.id}`)].join('|'))
          .digest('hex')
          .slice(0, 8);
        const quiet = act_on.length === 0 && refresh_due.length === 0 && new_items.length === 0;
        return JSON.stringify({ quiet, paused: isPaused(db, caller.project_id), act_on, ...(refresh_due.length > 0 ? { refresh_due } : {}), new_items, fingerprint });
      }),
  );

  server.registerTool(
    'resume_note_written',
    {
      description:
        'Architect or project manager only, when you were asked to write your resume note because your conversation is big: call it once progress.md and status.md are up to date, then stop. You are restarted with a fresh conversation that resumes from those notes; your developers keep running.',
      inputSchema: {},
    },
    () =>
      guard(() => {
        const caller = me(ctx);
        if (caller.role !== 'architect' && caller.role !== 'project-manager') throw new Error('Only architects and project managers can call resume_note_written');
        if (!markNoteReady(db, caller.id, now())) throw new Error('No refresh was requested for you. Carry on with your work.');
        return 'Noted. Stop now: you will be restarted fresh from your notes in a minute or two.';
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
        // Same model and scores as before: a restart is not a reason to change tier.
        const result = await launchDeveloper(ctx.launch, {
          architectId: caller.id,
          task: `${stored.task} ${RESTART_LINE}`,
          label: stored.label,
          model: target.model ?? undefined,
          complexity: target.complexity ?? undefined,
          clarity: target.clarity ?? undefined,
        });
        // Keep the original task, so a second restart does not repeat the restart line.
        saveSessionTask(db, result.session.id, stored.label, stored.task);
        return { session: result.session, replaced_session_id: session_id, warnings: [...stopped.warnings, ...result.warnings] };
      }),
  );
}
