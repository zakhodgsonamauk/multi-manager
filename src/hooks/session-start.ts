import { openRoster, resolveDbPath, type Env } from '../roster/db.ts';
import { formatItem, markSeen, openItemsFor } from '../roster/items.ts';
import { checkIn, getSession } from '../roster/sessions.ts';
import { sessionIdFromEnv } from './common.ts';

export interface SessionStartOutput {
  hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string };
}

export function runSessionStartHook(env: Env, now: Date = new Date()): SessionStartOutput | null {
  const sessionId = sessionIdFromEnv(env);
  if (sessionId === null) return null;
  const db = openRoster(resolveDbPath(env));
  try {
    if (getSession(db, sessionId) === undefined) return null;
    checkIn(db, sessionId, now);
    const items = openItemsFor(db, sessionId);
    markSeen(db, items.map((item) => item.id));
    const lines = [`Multi-Manager: you are roster session #${sessionId} (${env.MM_ROLE ?? 'unknown role'}).`];
    if (items.length === 0) {
      lines.push('No open roster items are addressed to you.');
    } else {
      lines.push('Open roster items addressed to you (act on them; close them with close_item when done):');
      for (const item of items) lines.push(formatItem(item));
    }
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
  } finally {
    db.close();
  }
}
