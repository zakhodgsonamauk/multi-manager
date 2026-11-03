import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CodeGraphRunner } from '../src/codegraph/codegraph.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { addProject, addWorkstream, getCodeGraph, requireWorkstream, setCodeGraph } from '../src/roster/projects.ts';
import { registerSession, setSessionState, startFrontDesk } from '../src/roster/sessions.ts';
import { registerRosterTools, type ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

type Role = 'front-desk' | 'project-manager' | 'architect' | 'developer';
/** Returns a failure for a command, or undefined to let it succeed. */
type Script = (file: string, args: string[]) => { stderr: string } | undefined;

async function world(t: TestContext, script: Script = () => undefined) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const alpha = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const beta = addProject(db, { name: 'beta', folder: 'C:\\b' });
  const main = requireWorkstream(db, alpha.id, 'main');
  const pmStream = addWorkstream(db, 'alpha', { name: 'pm', branch: 'main' });
  const pm = registerSession(db, { role: 'project-manager', parentId: desk.id, projectId: alpha.id, workstreamId: pmStream.id, name: 'pm-alpha' });
  const arch = registerSession(db, { role: 'architect', parentId: pm.id, projectId: alpha.id, workstreamId: main.id, name: 'arch-alpha' });
  const dev = registerSession(db, { role: 'developer', parentId: arch.id, projectId: alpha.id, workstreamId: main.id, name: 'dev-alpha' });
  const betaStream = addWorkstream(db, 'beta', { name: 'pm', branch: 'main' });
  const betaPm = registerSession(db, { role: 'project-manager', parentId: desk.id, projectId: beta.id, workstreamId: betaStream.id, name: 'pm-beta' });
  const calls: string[] = [];
  const run: CodeGraphRunner = (file, args, options) => {
    calls.push(`${options.cwd ?? ''}> ${file} ${args.join(' ')}`);
    const failure = script(file, args);
    return Promise.resolve({ ok: failure === undefined, code: failure === undefined ? 0 : 1, stdout: '', stderr: failure?.stderr ?? '' });
  };
  const as = async (sessionId: number, role: Role) => {
    const ctx: ToolContext = {
      db,
      identity: { sessionId, role },
      pluginRoot: '.',
      launch: { db, deps: {} as LaunchDeps, pluginRoot: '.', env: {} },
      codeGraphRunner: run,
    };
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerRosterTools(server, ctx);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    t.after(() => client.close());
    return async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { error: r.isError === true, text: r.content.map((c) => c.text).join('\n') };
    };
  };
  return { db, desk, pm, arch, dev, betaPm, calls, as };
}

test("set_code_graph: front desk and that project's running manager may switch it on and off", async (t) => {
  const { db, desk, pm, calls, as } = await world(t);
  assert.equal(getCodeGraph(db, 'alpha'), false);
  assert.equal((await (await as(desk.id, 'front-desk'))('set_code_graph', { project: 'alpha', enabled: true })).error, false);
  assert.equal(getCodeGraph(db, 'alpha'), true);
  assert.ok(calls.some((c) => c.includes('daemon add C:\\a')));
  assert.equal((await (await as(pm.id, 'project-manager'))('set_code_graph', { project: 'alpha', enabled: false })).error, false);
  assert.equal(getCodeGraph(db, 'alpha'), false);
  assert.ok(calls.some((c) => c.includes('daemon remove C:\\a')));
});

test("set_code_graph is refused for an architect, a developer and another project's manager", async (t) => {
  const { db, arch, dev, betaPm, calls, as } = await world(t);
  for (const [id, role] of [[arch.id, 'architect'], [dev.id, 'developer'], [betaPm.id, 'project-manager']] as const) {
    const r = await (await as(id, role))('set_code_graph', { project: 'alpha', enabled: true });
    assert.equal(r.error, true, role);
    assert.match(r.text, /Only the front desk or/);
  }
  assert.equal(getCodeGraph(db, 'alpha'), false);
  assert.deepEqual(calls, []);
});

test('set_code_graph is refused for a stopped project manager of the same project', async (t) => {
  const { db, pm, calls, as } = await world(t);
  const call = await as(pm.id, 'project-manager');
  setSessionState(db, pm.id, 'stopped');
  const r = await call('set_code_graph', { project: 'alpha', enabled: true });
  assert.equal(r.error, true);
  assert.match(r.text, /Only the front desk or/);
  assert.equal(getCodeGraph(db, 'alpha'), false);
  assert.deepEqual(calls, []);
});

test('set_code_graph stores the value only after the commands succeed (tool not installed)', async (t) => {
  const { db, desk, calls, as } = await world(t, (_file, args) => (args[0] === '--version' ? { stderr: 'spawn ENOENT' } : undefined));
  const r = await (await as(desk.id, 'front-desk'))('set_code_graph', { project: 'alpha', enabled: true });
  assert.equal(r.error, true);
  assert.match(r.text, /not installed/);
  assert.equal(getCodeGraph(db, 'alpha'), false);
  assert.equal(calls.length, 1);
});

test('set_code_graph: connection added but watch-list add fails -> flag not stored, error names the half-done state', async (t) => {
  const { db, desk, as } = await world(t, (_file, args) => (args[1] === 'get' ? { stderr: 'none' } : args[0] === 'daemon' ? { stderr: 'daemon down' } : undefined));
  const r = await (await as(desk.id, 'front-desk'))('set_code_graph', { project: 'alpha', enabled: true });
  assert.equal(r.error, true);
  assert.match(r.text, /tool connection was already added/);
  assert.match(r.text, /again finishes it/);
  assert.equal(getCodeGraph(db, 'alpha'), false);
});

test('set_code_graph: a failed disable leaves the flag on', async (t) => {
  const { db, desk, as } = await world(t, (_file, args) => (args[0] === 'daemon' ? { stderr: 'daemon down' } : undefined));
  setCodeGraph(db, 'alpha', true);
  const r = await (await as(desk.id, 'front-desk'))('set_code_graph', { project: 'alpha', enabled: false });
  assert.equal(r.error, true);
  assert.match(r.text, /already removed/);
  assert.equal(getCodeGraph(db, 'alpha'), true);
});
