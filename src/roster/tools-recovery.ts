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
import { requireSession, runningArchitect, runningChildren, type Session } from './sessions.ts';
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

/** Architects (with their dead developers under them) that died and nobody has dealt with yet. */
export function restorableSessions(db: DatabaseSync, readers: ActivityReaders) {
  const deaths = unresolvedDeaths(db);
  const architects = deaths.filter((s) => s.role === 'architect' && s.project_id !== null && s.workstream_id !== null);
  const listed = new Set(architects.map((a) => a.id));
  return {
    architects: architects.map((a) => {
      const project = requireProjectById(db, a.project_id as number);
      const other = runningArchitect(db, a.workstream_id as number);
      return {
        ...dead(db, a, readers),
        project: project.name,
        workstream: requireWorkstreamById(db, a.workstream_id as number).name,
        conversation_file_found: a.claude_session_id === null ? false : readers.findTranscript(a.claude_session_id) !== null,
        paused: isPaused(db, project.id),
        replaced_by: other === undefined || other.id === a.id ? null : (other.name ?? `session #${other.id}`),
        developers: deaths.filter((d) => d.role === 'developer' && d.parent_id === a.id).map((d) => dead(db, d, readers)),
        developers_still_running: runningChildren(db, a.id).map((d) => d.name ?? `session #${d.id}`),
      };
    }),
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
            list.architects.length === 0
              ? 'Nothing to bring back.'
              : 'Tell the user which architects stopped and ask once whether to bring them back (recommend yes). Only after a yes: restore_all, or restart_architect for one. Developers are not restarted; each architect decides after the user\'s go.',
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
        if (target.role !== 'architect') throw new Error(`Session #${a.session_id} is not an architect`);
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
        for (const arch of list.architects) {
          if (arch.paused) {
            skipped.push({ session_id: arch.session_id, name: arch.name, why: `${arch.project} is paused` });
            continue;
          }
          if (arch.replaced_by !== null) {
            skipped.push({ session_id: arch.session_id, name: arch.name, why: `${arch.replaced_by} is already running for ${arch.project}/${arch.workstream}` });
            continue;
          }
          try {
            restored.push(await restart(requireSession(db, arch.session_id), a.reason ?? DEFAULT_RESTART_REASON));
          } catch (error) {
            skipped.push({ session_id: arch.session_id, name: arch.name, why: error instanceof Error ? error.message : String(error) });
          }
        }
        return {
          restored,
          skipped,
          developers_not_restarted: list.architects.flatMap((x) => x.developers.map((d) => ({ architect: x.name, ...d }))),
          next: 'Architects will summarise and wait. Nothing new starts until the user says go.',
        };
      }),
  );
}
