import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Command } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, launchProjectManager, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import type { ActivityReaders } from '../src/monitor/activity.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { answerItem, getItem, markSeen, raiseItem, requireItem } from '../src/roster/items.ts';
import { addProject, addWorkstream } from '../src/roster/projects.ts';
import { frontDesk, requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerPauseTools } from '../src/roster/tools-pause.ts';
import { registerRecoveryTools } from '../src/roster/tools-recovery.ts';
import { registerRosterTools, type ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Nothing real is launched or killed. A process is "alive" until taskkill names it. */
function fakeDeps() {
  const runs: Command[] = [];
  const killed = new Set<number>();
  let nextPid = 4000;
  const deps: LaunchDeps = {
    run: async (command) => {
      runs.push(command);
      if (command.file === 'taskkill') killed.add(Number(command.args[1]));
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: () => {},
    waitForPid: async () => (nextPid += 1),
    findPid: async () => null,
    ownsProcess: async (pid) => !killed.has(pid),
    waitForWrapperPid: async () => null,
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
    readClaudeSessionId: (pid) => `conv-${pid}`,
    conversationExists: () => true,
  };
  return { deps, runs, killed };
}

const readers: ActivityReaders = { readSessionFile: () => null, findTranscript: () => null, mtimeMs: () => null };
const afterReboot = async (): Promise<ProcessInfo[]> => [{ pid: 1, ppid: 0, name: 'System', created: 0, commandLine: null }];

async function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', workstreams: [{ name: 'pm', branch: 'main' }, { name: 'api', branch: 'main' }, { name: 'web', branch: 'main' }] });
  addProject(db, { name: 'beta', folder: 'C:\\work\\beta' });
  addWorkstream(db, 'beta', { name: 'pm', branch: 'main' });
  const fake = fakeDeps();
  const launch: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const ctx: ToolContext = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: 'I:\\mm', launch };
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler) } as unknown as McpServer;
  registerPauseTools(server, ctx);
  registerRecoveryTools(server, ctx, { snapshot: afterReboot, readers });
  registerRosterTools(server, ctx);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return JSON.parse(text);
  };
  // Old-style pm architect (pm workstream) with two architects under it, one of which has a developer; plus its own developer.
  const { session: oldPm } = await launchArchitect(launch, { project: 'alpha', workstream: 'pm', parentId: desk.id });
  const { session: a1 } = await launchArchitect(launch, { project: 'alpha', workstream: 'api', parentId: oldPm.id });
  const { session: a2 } = await launchArchitect(launch, { project: 'alpha', workstream: 'web', parentId: oldPm.id });
  const { session: grandDev } = await launchDeveloper(launch, { architectId: a1.id, task: 'g', label: 'g' });
  const { session: ownDev } = await launchDeveloper(launch, { architectId: oldPm.id, task: 'o', label: 'o' });
  const pid = (id: number) => requireSession(db, id).pid as number;
  return { db, desk, launch, fake, call, oldPm, a1, a2, grandDev, ownDev, pid };
}

const state = (db: ReturnType<typeof tempRoster>, id: number) => requireSession(db, id).state;

test('hand-over: old pm and its own developer stop; architects and their developer keep running under the project manager', async (t) => {
  const { db, desk, launch, fake, call, oldPm, a1, a2, grandDev, ownDev, pid } = await setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const result = await call('stop_architect', { session_id: oldPm.id });
  assert.equal(state(db, oldPm.id), 'stopped');
  assert.equal(state(db, ownDev.id), 'stopped');
  assert.ok(fake.killed.has(pid(oldPm.id)) && fake.killed.has(pid(ownDev.id)));
  for (const s of [a1, a2, grandDev]) {
    assert.equal(state(db, s.id), 'running');
    assert.ok(!fake.killed.has(pid(s.id)));
  }
  assert.equal(requireSession(db, a1.id).parent_id, pm.id);
  assert.equal(requireSession(db, a2.id).parent_id, pm.id);
  assert.equal(requireSession(db, grandDev.id).parent_id, a1.id);
  assert.equal(result.handed_over.to.session_id, pm.id);
  assert.deepEqual(result.handed_over.architects.map((a: { session_id: number }) => a.session_id), [a1.id, a2.id]);
  assert.match(result.next, new RegExp(`Tell ${pm.name} it now manages ${a1.name}, ${a2.name}`));
  console.log(`CAPTURED next: ${result.next}`);
});

test('hand-over refused with no project manager: message leads with the point, nothing stopped or killed', async (t) => {
  const { db, fake, call, oldPm, a1, a2, grandDev, ownDev } = await setup(t);
  const runs = fake.runs.length;
  await assert.rejects(call('stop_architect', { session_id: oldPm.id }), (e: Error) => {
    assert.ok(e.message.startsWith('Not stopped:'));
    assert.ok(e.message.slice(0, 120).includes('no project manager'));
    assert.ok(e.message.includes(a1.name as string) && e.message.includes(a2.name as string));
    return true;
  });
  for (const s of [oldPm, a1, a2, grandDev, ownDev]) assert.equal(state(db, s.id), 'running');
  assert.equal(fake.killed.size, 0);
  assert.equal(fake.runs.length, runs);
  assert.equal(requireSession(db, a1.id).parent_id, oldPm.id);
  assert.equal(requireSession(db, a2.id).parent_id, oldPm.id);
});

test("a project manager of another project does not count", async (t) => {
  const { db, desk, launch, call, oldPm, a1 } = await setup(t);
  await launchProjectManager(launch, { project: 'beta', parentId: desk.id });
  await assert.rejects(call('stop_architect', { session_id: oldPm.id }), /^Error: Not stopped:/);
  assert.equal(state(db, oldPm.id), 'running');
  assert.equal(requireSession(db, a1.id).parent_id, oldPm.id);
});

test('an architect with only developers under it: unchanged, developers stop first, no handed_over', async (t) => {
  const { db, fake, call, a2, a1, grandDev, pid } = await setup(t);
  const result = await call('stop_architect', { session_id: a1.id });
  assert.equal(result.handed_over, undefined);
  assert.equal(result.next, undefined);
  assert.equal(state(db, a1.id), 'stopped');
  assert.equal(state(db, grandDev.id), 'stopped');
  assert.ok(fake.killed.has(pid(grandDev.id)));
  assert.equal(state(db, a2.id), 'running');
});

test('items: live items of handed architects move; answered, the old pm\'s own and other architects\' do not', async (t) => {
  const { db, desk, launch, call, oldPm, a1, a2 } = await setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const done = raiseItem(db, { kind: 'done', body: 'built', raisedBy: a1.id });
  const signoff = raiseItem(db, { kind: 'signoff', body: 'ok?', raisedBy: a1.id });
  const q = raiseItem(db, { kind: 'question', body: 'which?', raisedBy: a1.id });
  const answeredItem = answerItem(db, q.id, 'this one');
  const own = raiseItem(db, { kind: 'done', body: 'pm own', raisedBy: oldPm.id });
  const other = raiseItem(db, { kind: 'done', body: 'to old pm from nobody handed', raisedBy: null, addressedTo: oldPm.id });
  assert.equal(done.addressed_to, oldPm.id);
  assert.equal(signoff.addressed_to, oldPm.id);
  markSeen(db, [done.id, signoff.id]);
  const a2Item = raiseItem(db, { kind: 'info', body: 'fyi', raisedBy: a2.id });
  // An architect of the same project that is NOT under the old pm, with its own open item.
  addWorkstream(db, 'alpha', { name: 'ops', branch: 'main' });
  const { session: stray } = await launchArchitect(launch, { project: 'alpha', workstream: 'ops', parentId: desk.id });
  const strayItem = raiseItem(db, { kind: 'done', body: 'stray', raisedBy: stray.id });
  const strayBefore = { ...strayItem };
  // An answered item whose watcher is the old pm: the watcher is fixed, the addressee kept.
  const wq = raiseItem(db, { kind: 'question', body: 'watched?', raisedBy: a2.id });
  answerItem(db, wq.id, 'yes');
  db.prepare('UPDATE items SET watched_by = ? WHERE id = ?').run(oldPm.id, wq.id);

  const result = await call('stop_architect', { session_id: oldPm.id });

  const d = requireItem(db, done.id);
  assert.equal(d.addressed_to, pm.id);
  assert.equal(d.seen, 0);
  const s = requireItem(db, signoff.id);
  assert.equal(s.addressed_to, frontDesk(db).id);
  assert.equal(s.watched_by, pm.id);
  assert.equal(s.seen, 0);
  const a = requireItem(db, answeredItem.id);
  assert.equal(a.addressed_to, a1.id);
  assert.equal(a.state, 'answered');
  assert.equal(getItem(db, own.id)?.addressed_to, desk.id);
  assert.equal(getItem(db, other.id)?.addressed_to, oldPm.id);
  assert.equal(requireItem(db, a2Item.id).addressed_to, pm.id);
  assert.deepEqual(requireItem(db, strayItem.id), strayBefore);
  const w = requireItem(db, wq.id);
  assert.equal(w.watched_by, pm.id);
  assert.equal(w.addressed_to, a2.id);
  assert.equal(w.state, 'answered');
  assert.deepEqual(result.handed_over.items, [done.id, signoff.id, a2Item.id, wq.id]);
});

test('after the hand-over a moved architect routes by its new parent', async (t) => {
  const { db, desk, launch, call, oldPm, a1 } = await setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  await call('stop_architect', { session_id: oldPm.id });
  const done = raiseItem(db, { kind: 'done', body: 'later', raisedBy: a1.id });
  assert.equal(done.addressed_to, pm.id);
  const signoff = raiseItem(db, { kind: 'signoff', body: 'later?', raisedBy: a1.id });
  assert.equal(signoff.addressed_to, frontDesk(db).id);
  assert.equal(signoff.watched_by, pm.id);
});

test('pause still stops everything: no hand-over', async (t) => {
  const { db, desk, launch, call, oldPm, a1, a2, grandDev, ownDev } = await setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  await call('pause', { project: 'alpha' });
  await call('finish_pause', { project: 'alpha', force: true });
  for (const s of [pm, oldPm, a1, a2, grandDev, ownDev]) assert.equal(state(db, s.id), 'stopped');
  assert.equal(requireSession(db, a1.id).parent_id, oldPm.id);
});

test('by project and workstream hands over too', async (t) => {
  const { db, desk, launch, call, a1, a2 } = await setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const result = await call('stop_architect', { project: 'alpha', workstream: 'pm' });
  assert.equal(result.handed_over.to.session_id, pm.id);
  assert.equal(requireSession(db, a1.id).parent_id, pm.id);
  assert.equal(requireSession(db, a2.id).parent_id, pm.id);
  assert.equal(state(db, a1.id), 'running');
});
