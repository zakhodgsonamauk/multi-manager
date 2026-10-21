import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { realActivityReaders, type ActivityReaders } from '../monitor/activity.ts';
import { many } from './db.ts';
import { requireSession, type Session } from './sessions.ts';
import type { ToolContext } from './tools.ts';

/**
 * Mutes and unmutes the session-voice plugin per session. session-voice stays silent for a Claude Code
 * session if ~/.claude/session-voice/muted/<claude session id> exists or MM_VOICE=off is in its
 * environment (the launcher sets that for architects and developers), and speaks if
 * ~/.claude/session-voice/unmuted/<claude session id> exists, whatever the environment says.
 */
export function voiceDir(home: string = homedir()): string {
  return join(home, '.claude', 'session-voice');
}

const CLAUDE_SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/;

export type VoiceSetting = 'on' | 'off' | null;

/** What /voice or set_voice last chose for a Claude Code session; null if neither has. */
export function readVoiceSetting(dir: string, claudeSessionId: string): VoiceSetting {
  if (existsSync(join(dir, 'unmuted', claudeSessionId))) return 'on';
  if (existsSync(join(dir, 'muted', claudeSessionId))) return 'off';
  return null;
}

/** The same files session-voice's /voice command writes: one switch file, the other removed. */
export function writeVoiceSetting(dir: string, claudeSessionId: string, on: boolean): void {
  if (!CLAUDE_SESSION_ID.test(claudeSessionId)) throw new Error(`Not a Claude Code session id: ${claudeSessionId}`);
  const [add, drop] = on ? ['unmuted', 'muted'] : ['muted', 'unmuted'];
  try {
    unlinkSync(join(dir, drop, claudeSessionId));
  } catch {
    // not there
  }
  mkdirSync(join(dir, add), { recursive: true });
  writeFileSync(join(dir, add, claudeSessionId), `${new Date().toISOString()}\n`);
}

/** Front desk speaks unless told not to; launched architects and developers start with MM_VOICE=off. */
function voiceFor(session: Session, setting: VoiceSetting): { voice: 'on' | 'off'; reason: string } {
  if (setting !== null) return { voice: setting, reason: 'set with set_voice or /voice' };
  return session.role === 'front-desk' ? { voice: 'on', reason: 'front desk default' } : { voice: 'off', reason: 'started muted' };
}

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

export interface VoiceToolOptions {
  readers?: ActivityReaders;
  /** Folder holding muted/ and unmuted/; default ~/.claude/session-voice. */
  dir?: string;
  /** Live Claude pid for a session name; default the launcher's lookup. */
  findPid?: (name: string) => Promise<number | null>;
}

/** set_voice and voice_status. */
export function registerVoiceTools(server: McpServer, ctx: ToolContext, options: VoiceToolOptions = {}): void {
  const { db } = ctx;
  const readers = options.readers ?? realActivityReaders();
  const dir = options.dir ?? voiceDir();
  const findPid = options.findPid ?? ((name: string) => ctx.launch.deps.findPid(name));

  /** Roster session -> Claude Code session id, via ~/.claude/sessions/<claude pid>.json. */
  const claudeSessionId = async (session: Session): Promise<string | null> => {
    const fromPid = (pid: number | null): string | null => {
      if (pid === null) return null;
      const file = readers.readSessionFile(pid);
      const id = file !== null && typeof file === 'object' ? (file as Record<string, unknown>).sessionId : undefined;
      return typeof id === 'string' && CLAUDE_SESSION_ID.test(id) ? id : null;
    };
    const known = fromPid(session.pid);
    if (known !== null || session.name === null) return known;
    // The front desk has no stored pid: find its Claude process by its -n name.
    return fromPid(await findPid(session.name));
  };

  const me = (): Session => {
    if (ctx.identity.sessionId === null) throw new Error('This session is not registered with the roster');
    return requireSession(db, ctx.identity.sessionId);
  };

  server.registerTool(
    'set_voice',
    {
      description:
        'Turn spoken notifications (the session-voice plugin) on or off for a session. Front desk: any session. Others: only themselves. Architects and developers start muted.',
      inputSchema: { session_id: z.number().int().positive().describe('Roster session id'), on: z.boolean() },
    },
    ({ session_id, on }) =>
      guard(async () => {
        const caller = me();
        if (caller.role !== 'front-desk' && caller.id !== session_id) throw new Error('Only the front desk can set another session\'s voice');
        const target = requireSession(db, session_id);
        const id = await claudeSessionId(target);
        if (id === null) throw new Error(`Session #${session_id} has no running Claude Code session to find`);
        writeVoiceSetting(dir, id, on);
        return { session_id, name: target.name, claude_session_id: id, voice: on ? 'on' : 'off' };
      }),
  );

  server.registerTool(
    'voice_status',
    {
      description: 'Whether each running session speaks (on) or is muted (off), and why. Pass session_id for just one.',
      inputSchema: { session_id: z.number().int().positive().optional() },
    },
    ({ session_id }) =>
      guard(async () => {
        const sessions =
          session_id !== undefined
            ? [requireSession(db, session_id)]
            : many<Session>(db.prepare("SELECT * FROM sessions WHERE state = 'running' ORDER BY id").all());
        const rows = [];
        for (const s of sessions) {
          const id = await claudeSessionId(s);
          rows.push({ session_id: s.id, name: s.name, role: s.role, claude_session_id: id, ...voiceFor(s, id === null ? null : readVoiceSetting(dir, id)) });
        }
        return rows;
      }),
  );
}
