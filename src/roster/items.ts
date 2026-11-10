import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { iso, many, one, tx } from './db.ts';
import { frontDesk, getSession, requireSession } from './sessions.ts';

export const ITEM_KINDS = ['signoff', 'question', 'blocked', 'done', 'info'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_STATES = ['open', 'answered', 'closed'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
const LIVE: readonly ItemState[] = ['open', 'answered'];

/** `action` items need the user to decide something; `info` items are for information only and clear themselves. */
export type ItemCategory = 'action' | 'info';
export const ACTION_KINDS: readonly ItemKind[] = ['signoff', 'question', 'blocked'];
export const INFO_KINDS: readonly ItemKind[] = ['done', 'info'];

export function itemCategory(kind: ItemKind): ItemCategory {
  return (ACTION_KINDS as readonly string[]).includes(kind) ? 'action' : 'info';
}

/** An item as `listItems` returns it: the stored row plus its category. */
export type ItemRow = Item & { category: ItemCategory };

const HOUR_MS = 3_600_000;
/** An information item older than this is closed by the monitor. */
export const AUTO_CLEAR_AFTER_HOURS = 24;
/** An information item of a finished (done or cancelled) goal is closed after this long. */
export const AUTO_CLEAR_FINISHED_GOAL_AFTER_HOURS = 1;

const sqlList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(', ');

export interface Item {
  id: number;
  goal_id: number | null;
  raised_by: number | null;
  kind: ItemKind;
  body: string;
  state: ItemState;
  answer: string | null;
  addressed_to: number;
  /** A session that sees this item (and its answer) without being asked to act on it or answer it; null when none. */
  watched_by: number | null;
  seen: number;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
}

export interface ItemInput {
  kind: ItemKind;
  body: string;
  goalId?: number | null;
  raisedBy?: number | null;
  addressedTo?: number | null;
}

export interface ItemFilter {
  addressedTo?: number;
  /** Items addressed to this session or watched by it. */
  involving?: number;
  states?: readonly ItemState[];
  unseenOnly?: boolean;
  goalId?: number;
}

interface Route {
  addressedTo: number;
  watchedBy: number | null;
}

/**
 * Default routing: the raiser's parent, else the front desk. One exception: an architect under a running
 * project manager sends sign-offs and questions straight to the front desk and the project manager watches.
 */
function defaultRoute(db: DatabaseSync, kind: ItemKind, raisedBy: number | null, now: Date): Route {
  if (raisedBy !== null) {
    const raiser = requireSession(db, raisedBy);
    if (raiser.parent_id !== null) {
      const parent = getSession(db, raiser.parent_id);
      const direct = kind === 'signoff' || kind === 'question';
      if (raiser.role === 'architect' && direct && parent?.role === 'project-manager') {
        // Sign-offs and questions are the user's to answer: straight to the front desk. A stopped manager watches nothing.
        return { addressedTo: frontDesk(db, now).id, watchedBy: parent.state === 'running' ? parent.id : null };
      }
      return { addressedTo: raiser.parent_id, watchedBy: null };
    }
  }
  return { addressedTo: frontDesk(db, now).id, watchedBy: null };
}

export function raiseItem(db: DatabaseSync, input: ItemInput, now: Date = new Date()): Item {
  if (!(ITEM_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Unknown item kind "${input.kind}"`);
  if (input.body.trim() === '') throw new Error('An item needs a body');
  const raisedBy = input.raisedBy ?? null;
  const route: Route = input.addressedTo != null ? { addressedTo: input.addressedTo, watchedBy: null } : defaultRoute(db, input.kind, raisedBy, now);
  const result = db
    .prepare(
      `INSERT INTO items (goal_id, raised_by, kind, body, state, addressed_to, watched_by, seen, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, 0, ?, ?)`,
    )
    .run(input.goalId ?? null, raisedBy, input.kind, input.body, route.addressedTo, route.watchedBy, iso(now), iso(now));
  return requireItem(db, Number(result.lastInsertRowid));
}

/**
 * After `raisers` were given a new parent: live items they raised that were addressed to or watched by the old
 * parent `fromSessionId` are routed as if raised now (same rule as `raiseItem`). Open items move to the new
 * route and become unseen; answered items stay with their raiser and only lose a watcher that was the old
 * parent. Returns the ids that changed. Call inside a transaction, after the parent change.
 */
export function rerouteItems(db: DatabaseSync, fromSessionId: number, raisers: readonly number[], now: Date = new Date()): number[] {
  const changed: number[] = [];
  for (const raiser of raisers) {
    const items = many<Item>(db.prepare("SELECT * FROM items WHERE raised_by = ? AND state IN ('open', 'answered') ORDER BY id").all(raiser));
    for (const item of items) {
      if (item.addressed_to !== fromSessionId && item.watched_by !== fromSessionId) continue;
      const route = defaultRoute(db, item.kind, raiser, now);
      if (item.state === 'open') {
        const moved = route.addressedTo !== item.addressed_to;
        db.prepare('UPDATE items SET addressed_to = ?, watched_by = ?, seen = ?, updated_at = ? WHERE id = ?').run(
          route.addressedTo,
          route.watchedBy,
          moved ? 0 : item.seen,
          iso(now),
          item.id,
        );
      } else if (item.watched_by === fromSessionId) {
        db.prepare('UPDATE items SET watched_by = ?, updated_at = ? WHERE id = ?').run(route.watchedBy, iso(now), item.id);
      } else continue;
      changed.push(item.id);
    }
  }
  return changed;
}

export function getItem(db: DatabaseSync, id: number): Item | undefined {
  return one<Item>(db.prepare('SELECT * FROM items WHERE id = ?').get(id));
}

export function requireItem(db: DatabaseSync, id: number): Item {
  const item = getItem(db, id);
  if (item === undefined) throw new Error(`Unknown item #${id}`);
  return item;
}

/** Stores the user's answer exactly as given (no trimming) and hands the item back to its raiser, unseen. */
export function answerItem(db: DatabaseSync, id: number, answer: string, now: Date = new Date()): Item {
  const item = requireItem(db, id);
  if (item.state !== 'open') throw new Error(`Item #${id} is ${item.state}, not open`);
  db.prepare(
    `UPDATE items SET state = 'answered', answer = ?, answered_at = ?, updated_at = ?, addressed_to = ?, seen = 0 WHERE id = ?`,
  ).run(answer, iso(now), iso(now), item.raised_by ?? item.addressed_to, id);
  return requireItem(db, id);
}

export interface AnswerReply {
  nudge: { to: string | null; message: string } | null;
  /** Set when nobody is nudged: why, in plain words. */
  note?: string;
}

/** Who to tell about an answered item: its new addressee if that session is running, otherwise nobody. */
export function answerReply(db: DatabaseSync, item: Item): AnswerReply {
  const to = getSession(db, item.addressed_to);
  if (to === undefined) return { nudge: null, note: `Answer saved. Session #${item.addressed_to} is not on the roster, so nobody was told.` };
  const name = to.name ?? `session #${to.id}`;
  if (to.state !== 'running') return { nudge: null, note: `Answer saved. ${name} is stopped, so nobody was told.` };
  return { nudge: { to: to.name, message: `check roster item #${item.id}` } };
}

export function closeItem(db: DatabaseSync, id: number, now: Date = new Date()): Item {
  requireItem(db, id);
  db.prepare("UPDATE items SET state = 'closed', updated_at = ? WHERE id = ?").run(iso(now), id);
  return requireItem(db, id);
}

export function listItems(db: DatabaseSync, filter: ItemFilter = {}): ItemRow[] {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.addressedTo !== undefined) {
    where.push('addressed_to = ?');
    params.push(filter.addressedTo);
  }
  if (filter.involving !== undefined) {
    where.push('(addressed_to = ? OR watched_by = ?)');
    params.push(filter.involving, filter.involving);
  }
  if (filter.states !== undefined && filter.states.length > 0) {
    where.push(`state IN (${filter.states.map(() => '?').join(', ')})`);
    params.push(...filter.states);
  }
  if (filter.unseenOnly === true) where.push('seen = 0');
  if (filter.goalId !== undefined) {
    where.push('goal_id = ?');
    params.push(filter.goalId);
  }
  const sql = `SELECT * FROM items${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
  return many<Item>(db.prepare(sql).all(...params)).map((item) => ({ ...item, category: itemCategory(item.kind) }));
}

export function markSeen(db: DatabaseSync, ids: readonly number[]): void {
  const statement = db.prepare('UPDATE items SET seen = 1 WHERE id = ?');
  for (const id of ids) statement.run(id);
}

export function openItemsFor(db: DatabaseSync, sessionId: number): Item[] {
  return listItems(db, { addressedTo: sessionId, states: LIVE });
}

export function unseenItemsFor(db: DatabaseSync, sessionId: number): Item[] {
  return listItems(db, { addressedTo: sessionId, states: LIVE, unseenOnly: true });
}

export function formatItem(item: Item): string {
  const goal = item.goal_id === null ? '' : `, goal #${item.goal_id}`;
  const head = `#${item.id} [${item.kind}, ${item.state}${goal}] ${item.body}`;
  return item.answer === null ? head : `${head}\n  Answer (verbatim): ${item.answer}`;
}

/**
 * Closes open information items that nobody needs any more: raised 24 hours ago or more, or raised an hour ago or
 * more on a goal that is done or cancelled. Action items and answered items are never touched. One UPDATE, so a
 * second pass closes nothing more. Returns how many it closed.
 */
export function autoClearItems(db: DatabaseSync, now: Date = new Date()): number {
  const old = iso(new Date(now.getTime() - AUTO_CLEAR_AFTER_HOURS * HOUR_MS));
  const finished = iso(new Date(now.getTime() - AUTO_CLEAR_FINISHED_GOAL_AFTER_HOURS * HOUR_MS));
  const result = db
    .prepare(
      `UPDATE items SET state = 'closed', updated_at = ?
       WHERE state = 'open' AND kind IN (${sqlList(INFO_KINDS)})
         AND (created_at <= ? OR (created_at <= ? AND goal_id IN (SELECT id FROM goals WHERE state IN ('done', 'cancelled'))))`,
    )
    .run(iso(now), old, finished);
  return Number(result.changes);
}

export interface ClearResult {
  count: number;
  information: number[];
  action: number[];
}

/**
 * The user's clear command: closes open items addressed to `sessionId` that were raised `olderThanMinutes` or more
 * minutes ago. Information items always; action items only with `includeAction`. Answered items are untouched.
 */
export function clearItems(
  db: DatabaseSync,
  sessionId: number,
  olderThanMinutes: number,
  includeAction: boolean = false,
  now: Date = new Date(),
): ClearResult {
  if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1) throw new Error('older_than_minutes must be a whole number, 1 or more');
  const cutoff = iso(new Date(now.getTime() - olderThanMinutes * 60_000));
  const kinds = includeAction ? ITEM_KINDS : INFO_KINDS;
  const rows = tx(db, () => {
    const found = many<{ id: number; kind: ItemKind }>(
      db
        .prepare(`SELECT id, kind FROM items WHERE state = 'open' AND addressed_to = ? AND created_at <= ? AND kind IN (${sqlList(kinds)}) ORDER BY id`)
        .all(sessionId, cutoff),
    );
    const close = db.prepare("UPDATE items SET state = 'closed', updated_at = ? WHERE id = ? AND state = 'open'");
    for (const row of found) close.run(iso(now), row.id);
    return found;
  });
  const information = rows.filter((r) => itemCategory(r.kind) === 'info').map((r) => r.id);
  const action = rows.filter((r) => itemCategory(r.kind) === 'action').map((r) => r.id);
  return { count: rows.length, information, action };
}
