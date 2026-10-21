import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { iso, many, one } from './db.ts';
import { frontDesk, requireSession } from './sessions.ts';

export const ITEM_KINDS = ['signoff', 'question', 'blocked', 'done', 'info'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_STATES = ['open', 'answered', 'closed'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
const LIVE: readonly ItemState[] = ['open', 'answered'];

export interface Item {
  id: number;
  goal_id: number | null;
  raised_by: number | null;
  kind: ItemKind;
  body: string;
  state: ItemState;
  answer: string | null;
  addressed_to: number;
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
  states?: readonly ItemState[];
  unseenOnly?: boolean;
  goalId?: number;
}

function defaultAddressee(db: DatabaseSync, raisedBy: number | null, now: Date): number {
  if (raisedBy !== null) {
    const raiser = requireSession(db, raisedBy);
    if (raiser.parent_id !== null) return raiser.parent_id;
  }
  return frontDesk(db, now).id;
}

export function raiseItem(db: DatabaseSync, input: ItemInput, now: Date = new Date()): Item {
  if (!(ITEM_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Unknown item kind "${input.kind}"`);
  if (input.body.trim() === '') throw new Error('An item needs a body');
  const raisedBy = input.raisedBy ?? null;
  const addressedTo = input.addressedTo ?? defaultAddressee(db, raisedBy, now);
  const result = db
    .prepare(
      `INSERT INTO items (goal_id, raised_by, kind, body, state, addressed_to, seen, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, 0, ?, ?)`,
    )
    .run(input.goalId ?? null, raisedBy, input.kind, input.body, addressedTo, iso(now), iso(now));
  return requireItem(db, Number(result.lastInsertRowid));
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

export function closeItem(db: DatabaseSync, id: number, now: Date = new Date()): Item {
  requireItem(db, id);
  db.prepare("UPDATE items SET state = 'closed', updated_at = ? WHERE id = ?").run(iso(now), id);
  return requireItem(db, id);
}

export function listItems(db: DatabaseSync, filter: ItemFilter = {}): Item[] {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.addressedTo !== undefined) {
    where.push('addressed_to = ?');
    params.push(filter.addressedTo);
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
  return many<Item>(db.prepare(sql).all(...params));
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
