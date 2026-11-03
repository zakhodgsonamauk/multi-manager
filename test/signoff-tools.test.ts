import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { getItem } from '../src/roster/items.ts';
import { addProject, addWorkstream, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerRosterTools, type ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

type Role = 'front-desk' | 'project-manager' | 'architect';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function world(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const alpha = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  addProject(db, { name: 'beta', folder: 'C:\\b' });
  const main = requireWorkstream(db, alpha.id, 'main');
  const pmStream = addWorkstream(db, 'alpha', { name: 'pm', branch: 'main' });
  const pm = registerSession(db, { role: 'project-manager', parentId: desk.id, projectId: alpha.id, workstreamId: pmStream.id, name: 'pm-alpha' });
  const arch = registerSession(db, { role: 'architect', parentId: pm.id, projectId: alpha.id, workstreamId: main.id, name: 'arch-alpha' });
  const betaId = (db.prepare("SELECT id FROM projects WHERE name = 'beta'").get() as { id: number }).id;
  const betaStream = addWorkstream(db, 'beta', { name: 'pm', branch: 'main' });
  const betaPm = registerSession(db, { role: 'project-manager', parentId: desk.id, projectId: betaId, workstreamId: betaStream.id, name: 'pm-beta' });
  const as = async (sessionId: number, role: Role) => {
    const ctx: ToolContext = { db, identity: { sessionId, role }, pluginRoot: '.', launch: { db, deps: {} as LaunchDeps, pluginRoot: '.', env: {} } };
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerRosterTools(server, ctx);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    t.after(() => client.close());
    return async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      const text = r.content.map((c) => c.text).join('\n');
      return { error: r.isError === true, text, json: (): Json => JSON.parse(text) };
    };
  };
  return { db, desk, alpha, pm, arch, betaPm, as };
}

test('raise_item reply for a watched sign-off nudges the front desk and the project manager', async (t) => {
  const { desk, pm, arch, as } = await world(t);
  const call = await as(arch.id, 'architect');
  const reply = (await call('raise_item', { kind: 'signoff', body: 'Plan' })).json();
  console.log(JSON.stringify(reply, null, 2));
  assert.equal(reply.item.addressed_to, desk.id);
  assert.equal(reply.item.watched_by, pm.id);
  assert.deepEqual(reply.nudge, { to: desk.name, message: `check roster item #${reply.item.id}` });
  assert.deepEqual(reply.watcher_nudge, { to: 'pm-alpha', message: `check roster item #${reply.item.id}` });
  const plain = (await call('raise_item', { kind: 'done', body: 'x' })).json();
  assert.equal(plain.watcher_nudge, undefined);
});

test('list_items as the project manager flags watched items; the manager cannot answer', async (t) => {
  const { db, pm, arch, as } = await world(t);
  const item = (await (await as(arch.id, 'architect'))('raise_item', { kind: 'question', body: 'Q?' })).json().item;
  const pmCall = await as(pm.id, 'project-manager');
  let listed = (await pmCall('list_items')).json();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].watching, true);
  const refused = await pmCall('answer_item', { item_id: item.id, answer: 'yes' });
  assert.equal(refused.error, true);
  assert.match(refused.text, /only watched by you/);
  assert.equal(getItem(db, item.id)?.state, 'open');
  const deskCall = await as(1, 'front-desk');
  assert.equal((await deskCall('answer_item', { item_id: item.id, answer: 'go' })).error, false);
  listed = (await pmCall('list_items')).json();
  assert.equal(listed[0].state, 'answered');
  assert.equal(listed[0].answer, 'go');
  assert.equal(listed[0].watching, true);
});

test("set_project_rules: front desk and that project's manager may; others are refused", async (t) => {
  const { db, desk, pm, arch, as } = await world(t);
  const rules = () => (db.prepare("SELECT standing_rules FROM projects WHERE name = 'alpha'").get() as { standing_rules: string | null }).standing_rules;
  const words = '\n  keep spaces  \n';
  const deskCall = await as(desk.id, 'front-desk');
  assert.equal((await deskCall('set_project_rules', { project: 'alpha', text: words })).error, false);
  assert.equal(rules(), words);
  const pmCall = await as(pm.id, 'project-manager');
  assert.equal((await pmCall('set_project_rules', { project: 'alpha', text: 'pm rule' })).error, false);
  assert.equal(rules(), 'pm rule');
  const refused = await (await as(arch.id, 'architect'))('set_project_rules', { project: 'alpha', text: 'x' });
  assert.equal(refused.error, true);
  assert.match(refused.text, /Only the front desk or/);
  assert.equal((await pmCall('set_project_rules', { project: 'beta', text: 'x' })).error, true);
  assert.equal(rules(), 'pm rule');
  await deskCall('set_project_rules', { project: 'alpha', text: '' });
  assert.equal(rules(), null);
  assert.ok('standing_rules' in (await deskCall('list_projects')).json()[0]);
});

test('add_project with standing_rules stores them', async (t) => {
  const { db, desk, as } = await world(t);
  await (await as(desk.id, 'front-desk'))('add_project', { name: 'gamma', folder: 'C:\\g', standing_rules: ' rule ' });
  assert.equal((db.prepare("SELECT standing_rules FROM projects WHERE name = 'gamma'").get() as { standing_rules: string }).standing_rules, ' rule ');
});

test('tool annoyances: workstreams by id, mark_seen single id, text instead of body', async (t) => {
  const { db, desk, alpha, arch, as } = await world(t);
  const call = await as(desk.id, 'front-desk');
  assert.ok((await call('list_workstreams', { project: String(alpha.id) })).json().length >= 1);
  assert.ok((await call('list_workstreams', { project: alpha.id })).json().length >= 1);
  const archCall = await as(arch.id, 'architect');
  const item = (await archCall('raise_item', { kind: 'info', body: 'x' })).json().item;
  assert.equal((await call('mark_seen', { item_id: item.id })).error, false);
  assert.equal(getItem(db, item.id)?.seen, 1);
  const bad = await archCall('raise_item', { kind: 'info', text: 'hello' });
  assert.equal(bad.error, true);
  assert.match(bad.text, /body/);
});

test('a watcher cannot answer, close or mark seen; the addressee can answer; mine_only false lists all', async (t) => {
  const { db, desk, pm, arch, as } = await world(t);
  const archCall = await as(arch.id, 'architect');
  const pmCall = await as(pm.id, 'project-manager');
  const deskCall = await as(desk.id, 'front-desk');
  const item = (await archCall('raise_item', { kind: 'signoff', body: 'Plan' })).json().item;
  assert.equal((await pmCall('answer_item', { item_id: item.id, answer: 'yes' })).error, true);
  assert.equal((await pmCall('close_item', { item_id: item.id })).error, true);
  assert.equal(getItem(db, item.id)?.state, 'open');
  const seen = (await pmCall('mark_seen', { item_id: item.id })).json();
  assert.deepEqual(seen.skipped, [item.id]);
  assert.equal(getItem(db, item.id)?.seen, 0);
  assert.equal((await deskCall('list_items', { unseen_only: true })).json().length, 1);
  assert.equal((await pmCall('list_items', { mine_only: false })).json().length, 1);
  // the addressee (an architect-role project manager relaying by hand) can still answer and close
  const forPm = (await archCall('raise_item', { kind: 'question', body: 'Q', addressed_to: pm.id })).json().item;
  const answered = (await pmCall('answer_item', { item_id: forPm.id, answer: 'ok' })).json();
  assert.equal(answered.item.state, 'answered');
  assert.equal((await archCall('close_item', { item_id: forPm.id })).error, false);
  // the watched answer nudges the watcher too
  const answeredWatched = (await deskCall('answer_item', { item_id: item.id, answer: 'go' })).json();
  assert.equal(answeredWatched.watcher_nudge.to, 'pm-alpha');
  assert.equal((await deskCall('close_item', { item_id: item.id })).error, false);
});
