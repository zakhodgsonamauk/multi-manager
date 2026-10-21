import type { Env } from '../roster/db.ts';

/** The roster id set at launch through --settings env, or null outside Multi-Manager sessions. */
export function sessionIdFromEnv(env: Env): number | null {
  const raw = env.MM_SESSION_ID;
  if (raw === undefined || raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
