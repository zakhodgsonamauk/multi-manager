import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActivityReaders } from '../src/monitor/activity.ts';
import { createGoal, updateGoal } from '../src/roster/goals.ts';
import { markSeen, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerHealthTools } from '../src/roster/tools-health.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

const MIN = 60_000;
const NOW = Date.parse('2026-11-10T12:00:00Z');

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
interface Digest {
  quiet: boolean;
  paused: boolean;
  act_on: { id: number; action: string }[];
  idle_past_limit: { id: number; idle_minutes: number }[];
  new_items: { id: number; kind: string; category: string; body: string }[];
  fingerprint: string;
}

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db, 'mm-front-desk', new Date(NOW));
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', idleStopMinutes: 30 });
  const main = requireWorkstream(db, project.id, 'main');
  // Checked in 200 minutes ago, so a quiet architect has been quiet for a long time.
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main', pid: 100 }, new Date(NOW - 200 * MIN));
  const files = new Map<number, { sessionId: string; status: string; statusUpdatedAt: number }>();
  const readers: ActivityReaders = { readSessionFile: (pid) => files.get(pid) ?? null, findTranscript: () => null, mtimeMs: () => null };
  const ctx = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: '', launch: {} } as unknown as ToolContext;
  const tools = new Map<string, Handler>();
  registerHealthTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as unknown as McpServer, ctx, { readers, now: () => NOW });
  const call = async (args: Record<string, unknown> = {}) => {
    const result = await tools.get('front_desk_digest')!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return { text, digest: JSON.parse(text) as Digest };
  };
  const setStatus = (status: 'busy' | 'idle', minutesAgo: number) => files.set(100, { sessionId: 's100', status, statusUpdatedAt: NOW - minutesAgo * MIN });
  return { db, desk, main, arch, ctx, call, setStatus };
}

test('a quiet answer says quiet and is under 200 characters', async (t) => {
  const { call } = setup(t);
  const { text, digest } = await call();
  assert.equal(digest.quiet, true);
  assert.equal(digest.paused, false);
  console.log(`quiet front_desk_digest length: ${text.length}`);
  assert.equal(text.length < 200, true);
});

test('a stuck architect appears in act_on', async (t) => {
  const { db, main, arch, call, setStatus } = setup(t);
  createGoal(db, { workstreamId: main.id, text: 'in flight' });
  setStatus('busy', 90);
  const { digest } = await call();
  assert.deepEqual(digest.act_on.map((a) => [a.id, a.action]), [[arch.id, 'nudge']]);
  assert.equal(digest.quiet, false);
});

test('an idle architect with no live goal is idle_past_limit; one with a live goal is not', async (t) => {
  const { db, main, arch, call, setStatus } = setup(t);
  setStatus('idle', 90);
  const none = await call();
  assert.deepEqual(none.digest.idle_past_limit.map((a) => [a.id, a.idle_minutes]), [[arch.id, 90]]);
  assert.deepEqual(none.digest.act_on, []);
  const goal = createGoal(db, { workstreamId: main.id, text: 'planned' });
  assert.deepEqual((await call()).digest.idle_past_limit, []);
  updateGoal(db, goal.id, { state: 'done' });
  assert.equal((await call()).digest.idle_past_limit.length, 1);
  setStatus('idle', 10);
  assert.deepEqual((await call()).digest.idle_past_limit, [], 'idle under the limit');
});

test('since filters new_items; the fingerprint is stable and changes when an item is added', async (t) => {
  const { db, desk, call } = setup(t);
  raiseItem(db, { kind: 'signoff', body: 'x'.repeat(500), addressedTo: desk.id }, new Date(NOW - 60 * MIN));
  const first = (await call()).digest;
  assert.equal(first.new_items.length, 1);
  assert.deepEqual([first.new_items[0].kind, first.new_items[0].category], ['signoff', 'action']);
  assert.equal(first.new_items[0].body.length <= 200, true);
  assert.equal((await call({ since: new Date(NOW - 30 * MIN).toISOString() })).digest.new_items.length, 0);
  assert.equal((await call()).digest.fingerprint, first.fingerprint);
  raiseItem(db, { kind: 'info', body: 'fyi', addressedTo: desk.id }, new Date(NOW - 5 * MIN));
  const second = (await call()).digest;
  assert.notEqual(second.fingerprint, first.fingerprint);
  assert.equal((await call({ since: new Date(NOW - 30 * MIN).toISOString() })).digest.new_items.length, 1);
});

test('a caller that is not the front desk is refused', async (t) => {
  const { arch, ctx, call } = setup(t);
  ctx.identity = { sessionId: arch.id, role: 'architect' };
  await assert.rejects(call(), /Only the front desk/);
});

test('an item the front desk has marked seen is left out of new_items, with or without since', async (t) => {
  const { db, desk, call } = setup(t);
  const item = raiseItem(db, { kind: 'signoff', body: 'approve?', addressedTo: desk.id }, new Date(NOW - 60 * MIN));
  assert.equal((await call()).digest.new_items.length, 1);
  markSeen(db, [item.id]);
  assert.deepEqual((await call()).digest.new_items, []);
  assert.deepEqual((await call({ since: new Date(NOW - 120 * MIN).toISOString() })).digest.new_items, []);
});

test('quiet is true when the only open item for the front desk is seen', async (t) => {
  const { db, desk, call } = setup(t);
  const item = raiseItem(db, { kind: 'info', body: 'fyi', addressedTo: desk.id }, new Date(NOW - 60 * MIN));
  assert.equal((await call()).digest.quiet, false);
  markSeen(db, [item.id]);
  assert.equal((await call()).digest.quiet, true);
});

test('an open item that becomes unseen again shows in new_items', async (t) => {
  const { db, desk, call } = setup(t);
  const item = raiseItem(db, { kind: 'question', body: 'which?', addressedTo: desk.id }, new Date(NOW - 60 * MIN));
  markSeen(db, [item.id]);
  assert.deepEqual((await call()).digest.new_items, []);
  // An item handed back to the front desk comes back unseen (what rerouting does to the flag).
  db.prepare('UPDATE items SET seen = 0 WHERE id = ?').run(item.id);
  assert.deepEqual((await call()).digest.new_items.map((i) => i.id), [item.id]);
  assert.equal((await call()).digest.quiet, false);
});
