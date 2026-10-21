import { openRoster, resolveDbPath, type Env } from '../roster/db.ts';
import { formatItem, markSeen, unseenItemsFor } from '../roster/items.ts';
import { checkIn, getSession } from '../roster/sessions.ts';
import { sessionIdFromEnv } from './common.ts';

export interface StopOutput {
  decision: 'block';
  reason: string;
}

/** Blocks at most once per batch of unseen items: they are marked seen as they are reported. */
export function runStopHook(env: Env, now: Date = new Date()): StopOutput | null {
  const sessionId = sessionIdFromEnv(env);
  if (sessionId === null) return null;
  const db = openRoster(resolveDbPath(env));
  try {
    if (getSession(db, sessionId) === undefined) return null;
    checkIn(db, sessionId, now);
    const unseen = unseenItemsFor(db, sessionId);
    if (unseen.length === 0) return null;
    markSeen(db, unseen.map((item) => item.id));
    return {
      decision: 'block',
      reason: [
        'New Multi-Manager roster items are addressed to you. Read them with the roster list_items tool, act on them, then stop:',
        ...unseen.map(formatItem),
      ].join('\n'),
    };
  } finally {
    db.close();
  }
}
