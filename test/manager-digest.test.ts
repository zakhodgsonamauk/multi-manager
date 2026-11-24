import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActivityReaders } from '../src/monitor/activity.ts';
import { markSeen, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerHealthTools } from '../src/roster/tools-health.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

const MIN = 60_000;
const NOW = Date.parse('2026-11-24T12:00:00Z');

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
interface Digest {
  quiet: boolean;
  paused: boolean;
  act_on: { id: number; action: string }[];
  refresh_due?: { id: number; message: string }[];
  new_items: { id: number; kind: string; body: string }[];
  fingerprint: string;
}

/** A project manager (pid 100) over one architect (pid 101) over one developer (pid 102). */
function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db, 'mm-front-desk', new Date(NOW));
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', idleStopMinutes: 30 });
  const main = requireWorkstream(db, project.id, 'main');
  const base = { projectId: project.id, workstreamId: main.id };
  const checkedIn = new Date(NOW - 200 * MIN);
  const pm = registerSession(db, { role: 'project-manager', parentId: desk.id, ...base, name: 'mm-alpha-pm', pid: 100 }, checkedIn);
  const arch = registerSession(db, { role: 'architect', parentId: pm.id, ...base, name: 'mm-alpha-main', pid: 101 }, checkedIn);
  const dev = registerSession(db, { role: 'developer', parentId: arch.id, ...base, name: 'mm-alpha-dev', pid: 102 }, checkedIn);
  const files = new Map<number, { sessionId: string; status: string; statusUpdatedAt: number }>();
  const readers: ActivityReaders = { readSessionFile: (pid) => files.get(pid) ?? null, findTranscript: () => null, mtimeMs: () => null };
  const ctx = { db, identity: { sessionId: arch.id, role: 'architect' }, pluginRoot: '', launch: {} } as unknown as ToolContext;
  const tools = new Map<string, Handler>();
  registerHealthTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as unknown as McpServer, ctx, { readers, now: () => NOW });
  const call = async (as: { id: number; role: string }, args: Record<string, unknown> = {}) => {
    ctx.identity = { sessionId: as.id, role: as.role } as never;
    const result = await tools.get('manager_digest')!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return { text, digest: JSON.parse(text) as Digest };
  };
  // Everyone busy and fresh: nothing to act on.
  const setStatus = (pid: number, status: 'busy' | 'idle', minutesAgo: number) => files.set(pid, { sessionId: `s${pid}`, status, statusUpdatedAt: NOW - minutesAgo * MIN });
  for (const pid of [100, 101, 102]) setStatus(pid, 'busy', 1);
  const nudge = async (as: { id: number; role: string }, sessionId: number) => {
    ctx.identity = { sessionId: as.id, role: as.role } as never;
    await tools.get('record_nudge')!({ session_id: sessionId });
  };
  return { db, desk, pm, arch, dev, call, setStatus, nudge };
}

test('an architect whose developers are all fine and who has no unseen items gets a quiet digest', async (t) => {
  const { arch, call } = setup(t);
  const { text, digest } = await call(arch);
  assert.equal(digest.quiet, true);
  assert.equal(digest.paused, false);
  console.log(`quiet manager_digest length: ${text.length}`);
  assert.equal(text.length < 200, true);
});

test('an architect digest is not quiet when a developer needs a nudge', async (t) => {
  const { arch, dev, call, setStatus } = setup(t);
  setStatus(102, 'busy', 90);
  const { digest } = await call(arch);
  assert.deepEqual(digest.act_on.map((a) => [a.id, a.action]), [[dev.id, 'nudge']]);
  assert.equal(digest.quiet, false);
});

test('an architect digest is not quiet for an item addressed to it, and quiet again once it is seen', async (t) => {
  const { db, arch, dev, call } = setup(t);
  const item = raiseItem(db, { kind: 'done', body: 'finished', raisedBy: dev.id, addressedTo: arch.id }, new Date(NOW - MIN));
  const first = (await call(arch)).digest;
  assert.deepEqual(first.new_items.map((i) => i.id), [item.id]);
  assert.equal(first.quiet, false);
  markSeen(db, [item.id]);
  assert.equal((await call(arch)).digest.quiet, true);
});

test('the fingerprint is stable while nothing changes and changes with a new item', async (t) => {
  const { db, arch, call } = setup(t);
  raiseItem(db, { kind: 'info', body: 'one', addressedTo: arch.id }, new Date(NOW - 5 * MIN));
  const a = (await call(arch)).digest.fingerprint;
  assert.equal((await call(arch)).digest.fingerprint, a);
  raiseItem(db, { kind: 'info', body: 'two', addressedTo: arch.id }, new Date(NOW - MIN));
  assert.notEqual((await call(arch)).digest.fingerprint, a);
});

test('a project manager digest looks at its architects, not at their developers', async (t) => {
  const { pm, arch, call, setStatus } = setup(t);
  assert.equal((await call(pm)).digest.quiet, true);
  setStatus(102, 'busy', 90); // the developer is stuck: the architect's business
  assert.equal((await call(pm)).digest.quiet, true);
  setStatus(101, 'busy', 90); // the architect is stuck: the project manager's business
  const { digest } = await call(pm);
  assert.deepEqual(digest.act_on.map((a) => [a.id, a.action]), [[arch.id, 'nudge']]);
});

test('a project manager is told about an item it only watches, once, by `since`', async (t) => {
  const { db, desk, pm, arch, call } = setup(t);
  // An architect under a project manager sends a question to the front desk; the project manager watches.
  const item = raiseItem(db, { kind: 'question', body: 'which db?', raisedBy: arch.id }, new Date(NOW - 5 * MIN));
  assert.equal(item.addressed_to, desk.id);
  assert.equal(item.watched_by, pm.id);
  const first = (await call(pm)).digest;
  assert.deepEqual(first.new_items.map((i) => i.id), [item.id]);
  assert.equal(first.quiet, false);
  const later = (await call(pm, { since: new Date(NOW - MIN).toISOString() })).digest;
  assert.deepEqual(later.new_items, []);
  assert.equal(later.quiet, true);
});

test('a manager asked for its resume note gets its own refresh_due entry', async (t) => {
  const { db, arch, call } = setup(t);
  db.exec('CREATE TABLE IF NOT EXISTS manager_lifecycle (session_id INTEGER PRIMARY KEY REFERENCES sessions(id), refresh_requested_at INTEGER, note_ready_at INTEGER, idle_stopped_at INTEGER, idle_stopped_pid INTEGER)');
  db.prepare('INSERT INTO manager_lifecycle (session_id, refresh_requested_at) VALUES (?, ?)').run(arch.id, NOW - 5 * MIN);
  const { digest } = await call(arch);
  assert.deepEqual(digest.refresh_due?.map((r) => r.id), [arch.id]);
  assert.match(digest.refresh_due?.[0].message ?? '', /resume_note_written/);
  assert.equal(digest.quiet, false);
});

test('developers and the front desk are refused', async (t) => {
  const { dev, desk, call } = setup(t);
  await assert.rejects(call(dev), /Only architects and project managers/);
  await assert.rejects(call(desk), /Only architects and project managers/);
});

test('a stuck developer gets a new check-in after each nudge and reaches restart', async (t) => {
  const { arch, dev, call, setStatus, nudge } = setup(t);
  setStatus(102, 'busy', 90);
  const first = (await call(arch)).digest;
  assert.deepEqual(first.act_on.map((a) => [a.id, a.action]), [[dev.id, 'nudge']]);
  await nudge(arch, dev.id);
  const second = (await call(arch)).digest;
  assert.notEqual(second.fingerprint, first.fingerprint, 'after the first nudge the digest must look new');
  assert.equal(second.act_on[0].action, 'nudge');
  await nudge(arch, dev.id);
  const third = (await call(arch)).digest;
  assert.notEqual(third.fingerprint, second.fingerprint);
  assert.equal(third.act_on[0].action, 'restart', 'after two nudges a developer escalates to restart');
});
