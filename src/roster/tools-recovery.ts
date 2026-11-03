import type { DatabaseSync } from 'node:sqlite';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { restartArchitect } from '../launch/launcher.ts';
import { realActivityReaders, type ActivityReaders } from '../monitor/activity.ts';
import { closeHealthItems, unresolvedDeaths } from '../monitor/health.ts';
import { detectDeaths } from '../monitor/monitor.ts';
import { snapshotProcesses, type ProcessInfo } from '../monitor/processes.ts';
import { one } from './db.ts';
import { isPaused } from './pause.ts';
import { requireProjectById, requireWorkstreamById } from './projects.ts';
import { requireSession, runningArchitect, runningChildren, runningProjectManager, type Session } from './sessions.ts';
import type { ToolContext } from './tools.ts';

/**
 * Crash and reboot recovery. Architects are NEVER restarted automatically: restorable_sessions lists them,
 * the front desk asks the user, and only then calls restart_architect or restore_all. Developers are not
 * restarted here; each architect decides after the user's go (restart_developer).
 */
async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

function frontDeskOnly(ctx: ToolContext, tool: string): Session {
  if (ctx.identity.sessionId === null) throw new Error('This session is not registered with the roster');
  const caller = requireSession(ctx.db, ctx.identity.sessionId);
  if (caller.role !== 'front-desk') throw new Error(`Only the front desk can call ${tool}`);
  return caller;
}

export interface RecoveryToolOptions {
  /** Live process snapshot; defaults to the real one. Tests pass fakes. */
  snapshot?: () => Promise<ProcessInfo[]>;
  readers?: ActivityReaders;
  now?: () => Date;
}

export const DEFAULT_RESTART_REASON = 'your session ended unexpectedly (a crash or a machine restart)';

interface DeadSession {
  session_id: number;
  name: string;
  died_at: string | null;
  last_activity: string | null;
  conversation_id_present: boolean;
}

function lastActivity(s: Session, readers: ActivityReaders): string | null {
  const transcript = s.claude_session_id === null ? null : readers.findTranscript(s.claude_session_id);
  const times = [s.last_checkin_at === null ? null : Date.parse(s.last_checkin_at), transcript === null ? null : readers.mtimeMs(transcript)];
  const valid = times.filter((t): t is number => t !== null && Number.isFinite(t));
  return valid.length === 0 ? null : new Date(Math.max(...valid)).toISOString();
}

function dead(db: DatabaseSync, s: Session, readers: ActivityReaders): DeadSession {
  const died = one<{ at: string | null }>(db.prepare('SELECT MAX(at) AS at FROM monitor_deaths WHERE session_id = ?').get(s.id));
  return {
    session_id: s.id,
    name: s.name ?? `session #${s.id}`,
    died_at: died?.at ?? null,
    last_activity: lastActivity(s, readers),
    conversation_id_present: s.claude_session_id !== null,
  };
}

/**
 * Project managers and architects (with their dead developers under them) that died and nobody has dealt with yet.
 * An architect whose parent project manager is also in the list is nested under it; the rest stay in `architects`.
 */
export function restorableSessions(db: DatabaseSync, readers: ActivityReaders) {
  const deaths = unresolvedDeaths(db);
  const placed = (s: Session): boolean => s.project_id !== null && s.workstream_id !== null;
  const managers = deaths.filter((s) => s.role === 'project-manager' && placed(s));
  const managerIds = new Set(managers.map((m) => m.id));
  const architects = deaths.filter((s) => s.role === 'architect' && placed(s));
  const listed = new Set(architects.map((a) => a.id));
  const where = (s: Session) => {
    const project = requireProjectById(db, s.project_id as number);
    return {
      project: project.name,
      workstream: requireWorkstreamById(db, s.workstream_id as number).name,
      conversation_file_found: s.claude_session_id === null ? false : readers.findTranscript(s.claude_session_id) !== null,
      paused: isPaused(db, project.id),
    };
  };
  const architectEntry = (a: Session) => {
    const other = runningArchitect(db, a.workstream_id as number);
    return {
      ...dead(db, a, readers),
      ...where(a),
      replaced_by: other === undefined || other.id === a.id ? null : (other.name ?? `session #${other.id}`),
      developers: deaths.filter((d) => d.role === 'developer' && d.parent_id === a.id).map((d) => dead(db, d, readers)),
      developers_still_running: runningChildren(db, a.id).map((d) => d.name ?? `session #${d.id}`),
    };
  };
  return {
    project_managers: managers.map((m) => {
      const other = runningProjectManager(db, m.project_id as number);
      return {
        ...dead(db, m, readers),
        ...where(m),
        replaced_by: other === undefined || other.id === m.id ? null : (other.name ?? `session #${other.id}`),
        architects: architects.filter((a) => a.parent_id === m.id).map(architectEntry),
        architects_still_running: runningChildren(db, m.id).map((a) => a.name ?? `session #${a.id}`),
      };
    }),
    architects: architects.filter((a) => a.parent_id === null || !managerIds.has(a.parent_id)).map(architectEntry),
    other_developers: deaths.filter((d) => d.role === 'developer' && (d.parent_id === null || !listed.has(d.parent_id))).map((d) => dead(db, d, readers)),
  };
}

export function registerRecoveryTools(server: McpServer, ctx: ToolContext, options: RecoveryToolOptions = {}): void {
  const { db } = ctx;
  const snapshot = options.snapshot ?? snapshotProcesses;
  const readers = options.readers ?? realActivityReaders();
  const now = options.now ?? (() => new Date());

  /** Marks sessions whose process is gone as dead now, so a reboot shows up before the monitor's next pass. */
  const refresh = async (): Promise<void> => {
    const processes = await snapshot();
    if (processes.length === 0) throw new Error('Could not read the process list, so it is unknown what is still running. Try again.');
    detectDeaths(db, processes, now());
  };

  const restart = async (session: Session, reason: string) => {
    const result = await restartArchitect(ctx.launch, { sessionId: session.id, reason });
    closeHealthItems(db, session.id, now());
    return {
      session_id: result.session.id,
      name: result.session.name,
      resumed: result.resumed,
      warnings: result.warnings,
    };
  };

  server.registerTool(
    'restorable_sessions',
    {
      description:
        'Front desk only. Architects that died (crash, or everything after a machine restart) and have not been dealt with, each with its dead developers, project, workstream, last activity and whether its conversation can be resumed. Call on start. Offer to bring them back; never restart unasked.',
      inputSchema: {},
    },
    () =>
      guard(async () => {
        frontDeskOnly(ctx, 'restorable_sessions');
        await refresh();
        const list = restorableSessions(db, readers);
        return {
          ...list,
          paused: isPaused(db),
          next:
            list.architects.length === 0 && list.project_managers.length === 0
              ? 'Nothing to bring back.'
              : 'Tell the user which project managers and architects stopped and ask once whether to bring them back (recommend yes). Only after a yes: restore_all, or restart_architect for one (it takes a project manager too). Developers are not restarted; each architect decides after the user\'s go.',
        };
      }),
  );

  server.registerTool(
    'restart_architect',
    {
      description:
        'Front desk only, and only after the user said yes. Restarts one architect under the same roster id from its saved conversation (claude --resume), or fresh if that is gone; it re-reads its progress log and WAITS for the user\'s go. Its developers are left alone. Closes its death item. Refused while paused.',
      inputSchema: {
        session_id: z.number().int().positive().describe('The architect\'s roster session id'),
        reason: z.string().optional().describe('Why it stopped, e.g. "a crash"; default: crash or machine restart'),
      },
    },
    (a) =>
      guard(async () => {
        frontDeskOnly(ctx, 'restart_architect');
        const target = requireSession(db, a.session_id);
        if (target.role !== 'architect' && target.role !== 'project-manager') throw new Error(`Session #${a.session_id} is not an architect or project manager`);
        return restart(target, a.reason ?? DEFAULT_RESTART_REASON);
      }),
  );

  server.registerTool(
    'restore_all',
    {
      description:
        'Front desk only, and only after the user said yes. Restarts every restorable architect (resuming its conversation where it can). Developers are NOT restarted; each architect decides after the user\'s go. Refused while everything is paused; architects of a paused project are skipped.',
      inputSchema: { reason: z.string().optional() },
    },
    (a) =>
      guard(async () => {
        frontDeskOnly(ctx, 'restore_all');
        if (isPaused(db)) throw new Error('Not restoring: everything is paused. Resume first (after the user says go).');
        await refresh();
        const list = restorableSessions(db, readers);
        const restored: Awaited<ReturnType<typeof restart>>[] = [];
        const skipped: { session_id: number; name: string; why: string }[] = [];
        const reparented: { session_id: number; name: string; parent: string }[] = [];
        const bringBack = async (
          entry: { session_id: number; name: string; project: string; workstream: string; paused: boolean; replaced_by: string | null },
          manager?: { session_id: number },
        ) => {
          if (entry.paused) {
            skipped.push({ session_id: entry.session_id, name: entry.name, why: `${entry.project} is paused` });
            return;
          }
          if (entry.replaced_by !== null) {
            skipped.push({ session_id: entry.session_id, name: entry.name, why: `${entry.replaced_by} is already running for ${entry.project}/${entry.workstream}` });
            return;
          }
          try {
            // Its project manager was not brought back: hang it under the project's running one, else the front desk.
            if (manager !== undefined && !restored.some((r) => r.session_id === manager.session_id)) {
              const target = requireSession(db, entry.session_id);
              const parent = runningProjectManager(db, target.project_id as number) ?? frontDeskOnly(ctx, 'restore_all');
              db.prepare('UPDATE sessions SET parent_id = ? WHERE id = ?').run(parent.id, target.id);
              reparented.push({ session_id: target.id, name: entry.name, parent: parent.name ?? `session #${parent.id}` });
            }
            restored.push(await restart(requireSession(db, entry.session_id), a.reason ?? DEFAULT_RESTART_REASON));
          } catch (error) {
            skipped.push({ session_id: entry.session_id, name: entry.name, why: error instanceof Error ? error.message : String(error) });
          }
        };
        // Project managers first, then their architects (a restart keeps the row, so the parent link holds), then the rest.
        for (const manager of list.project_managers) {
          await bringBack(manager);
          for (const arch of manager.architects) await bringBack(arch, manager);
        }
        for (const arch of list.architects) await bringBack(arch);
        const everyArchitect = [...list.project_managers.flatMap((m) => m.architects), ...list.architects];
        return {
          restored,
          skipped,
          reparented,
          developers_not_restarted: everyArchitect.flatMap((x) => x.developers.map((d) => ({ architect: x.name, ...d }))),
          next: 'Architects will summarise and wait. Nothing new starts until the user says go.',
        };
      }),
  );
}
