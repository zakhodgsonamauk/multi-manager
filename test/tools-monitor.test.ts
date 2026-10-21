import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LaunchDeps } from '../src/launch/runner.ts';
import type { MonitorDeps } from '../src/monitor/monitor.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerMonitorTools } from '../src/roster/tools-monitor.ts';
import type { Identity, ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

function proc(pid: number, ppid: number, name: string, created: number): ProcessInfo {
  return { pid, ppid, name, created, commandLine: null };
}

const noLaunch = {} as LaunchDeps;

async function connect(t: TestContext, identity: (ids: { desk: number; arch: number; dev: number }) => Identity) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  addProject(db, { name: 'beta', folder: 'C:\\b' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'arch', pid: 10 });
  const dev = registerSession(db, { role: 'developer', parentId: arch.id, projectId: project.id, workstreamId: main.id, name: 'dev', pid: 20 });
  const killed: number[] = [];
  const snapshot = [proc(1, 0, 'node.exe', 0), proc(10, 1, 'claude.exe', 100), proc(20, 1, 'claude.exe', 100), proc(21, 20, 'godot.exe', 200), proc(22, 20, 'godot.exe', 300)];
  const deps: MonitorDeps = {
    snapshot: () => Promise.resolve(snapshot),
    kill: (pid) => {
      killed.push(pid);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    },
    selfPid: 1,
  };
  const ctx: ToolContext = { db, identity: identity({ desk: desk.id, arch: arch.id, dev: dev.id }), pluginRoot: '.', launch: { db, deps: noLaunch, pluginRoot: '.', env: {} } };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerMonitorTools(server, ctx, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(() => client.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = result.content.map((c) => c.text).join('\n');
    return { error: result.isError === true, text, json: () => JSON.parse(text) as unknown };
  };
  return { call, killed, client };
}

test('monitor tools: limits, resources, a tick that enforces, and number allocation', async (t) => {
  const { call, killed, client } = await connect(t, (ids) => ({ sessionId: ids.arch, role: 'architect' }));
  assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(), ['allocate_number', 'get_limits', 'monitor_tick', 'resources', 'set_limits']);

  const set = await call('set_limits', { session_binary_caps: { 'godot.exe': 1 }, machine_binary_caps: { 'godot.exe': 6 }, stall_minutes: 30 });
  assert.equal(set.error, false, set.text);
  assert.deepEqual(set.json(), { project: 'alpha', project_id: 1, max_processes_per_session: null, session_binary_caps: { 'godot.exe': 1 }, machine_binary_caps: { 'godot.exe': 6 }, stall_minutes: 30 });
  const other = await call('set_limits', { project: 'beta', max_processes_per_session: 3 });
  assert.equal(other.error, true);
  assert.match(other.text, /Only the front desk or this project's architect/);

  const all = (await call('get_limits')).json() as { project: string }[];
  assert.deepEqual(all.map((l) => l.project), ['alpha', 'beta']);

  const resources = (await call('resources')).json() as { name: string; binaries: { count: number; over: boolean }[] }[];
  assert.deepEqual(resources.map((r) => [r.name, r.binaries[0].count, r.binaries[0].over]), [['arch', 0, false], ['dev', 2, true]]);

  const tick = (await call('monitor_tick')).json() as { enforcements: { rule: string }[]; deaths: unknown[] };
  assert.deepEqual(tick.enforcements.map((e) => e.rule), ['session_binary_cap']);
  assert.deepEqual(killed, [22]);

  assert.deepEqual((await call('allocate_number', { kind: 'task', at_least: 7 })).json(), { project: 'alpha', kind: 'task', number: 7 });
  assert.deepEqual((await call('allocate_number', { kind: 'task' })).json(), { project: 'alpha', kind: 'task', number: 8 });
});

test('developers cannot change limits', async (t) => {
  const { call } = await connect(t, (ids) => ({ sessionId: ids.dev, role: 'developer' }));
  const result = await call('set_limits', { max_processes_per_session: 100 });
  assert.equal(result.error, true);
});
