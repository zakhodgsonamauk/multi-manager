import type { DatabaseSync } from 'node:sqlite';
import type { Env } from './db.ts';
import { iso } from './db.ts';
import { frontDeskNameFromEnv, type Session } from './sessions.ts';
import type { Identity } from './tools.ts';

/** While the session is still unrecognised, the monitor's check looks at most this often. */
export const RECOGNISE_RETRY_MS = 30_000;

export interface FrontDeskProbeDeps {
  db: DatabaseSync;
  env: Env;
  /** The roster server's parent process id (the session's claude.exe), or null if unknown. */
  parentPid: () => number | null;
  /** Parsed ~/.claude/sessions/<pid>.json, or null if missing or unreadable. */
  readSessionFile: (pid: number) => unknown;
  nowMs?: () => number;
  now?: () => Date;
}

export interface FrontDeskProbe {
  /** The front desk's identity if this server's parent session is the front desk, else null. */
  recognise: (options?: { throttled?: boolean }) => Identity | null;
}

/**
 * Recognises the front desk by its own Claude Code process. Used only when the environment gives no identity
 * (no MM_SESSION_ID, and MM_ROLE absent or front-desk). The parent's session file name must equal the front-desk
 * record's name (or MM_FRONT_DESK_NAME when the record has none); anything else stays unregistered.
 */
export function createFrontDeskProbe(deps: FrontDeskProbeDeps): FrontDeskProbe {
  let lastTryMs: number | null = null;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const now = deps.now ?? (() => new Date());

  function environmentGivesIdentity(): boolean {
    if (deps.env.MM_SESSION_ID !== undefined && deps.env.MM_SESSION_ID !== '') return true;
    return deps.env.MM_ROLE !== undefined && deps.env.MM_ROLE !== '' && deps.env.MM_ROLE !== 'front-desk';
  }

  return {
    recognise: (options = {}) => {
      if (environmentGivesIdentity()) return null;
      const t = nowMs();
      if (options.throttled === true && lastTryMs !== null && t - lastTryMs < RECOGNISE_RETRY_MS) return null;
      lastTryMs = t;
      const pid = deps.parentPid();
      if (pid === null) return null;
      const file = deps.readSessionFile(pid);
      const name = file !== null && typeof file === 'object' ? (file as Record<string, unknown>).name : undefined;
      if (typeof name !== 'string' || name === '') return null;
      const desk = deps.db.prepare("SELECT * FROM sessions WHERE role = 'front-desk' ORDER BY id LIMIT 1").get() as Session | undefined;
      if (desk === undefined) return null;
      if (name !== (desk.name ?? frontDeskNameFromEnv(deps.env))) return null;
      deps.db.prepare('UPDATE sessions SET last_checkin_at = ? WHERE id = ?').run(iso(now()), desk.id);
      return { sessionId: desk.id, role: 'front-desk' };
    },
  };
}
