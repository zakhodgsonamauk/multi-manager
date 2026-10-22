import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Command } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import { listItems } from '../src/roster/items.ts';
import { endPause, isPaused, startPause } from '../src/roster/pause.ts';
import { addProject } from '../src/roster/projects.ts';
import { requireSession, setSessionModel, startFrontDesk } from '../src/roster/sessions.ts';
import { registerPauseTools } from '../src/roster/tools-pause.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Fake launcher deps: pids by name, and a process is "alive" until taskkill names it. Nothing real is started or killed. */
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
    // No wrapper pid, so stop falls back to the claude.exe pid that this fake tracks.
    waitForWrapperPid: async () => null,
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
  };
  return { deps, runs, killed };
}

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha' });
  addProject(db, { name: 'beta', folder: 'C:\\work\\beta' });
  const fake = fakeDeps();
  const launch: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const ctx: ToolContext = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: 'I:\\mm', launch };
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler) } as unknown as McpServer;
  registerPauseTools(server, ctx);
  const as = (sessionId: number) => {
    ctx.identity = { sessionId, role: requireSession(db, sessionId).role };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return JSON.parse(text);
  };
  return { db, desk, launch, ctx, fake, as, call };
}

test('a project pause covers only that project; a whole pause covers all', (t) => {
  const { db } = setup(t);
  const alpha = 1;
  const beta = 2;
  const p = startPause(db, { projectId: alpha });
  assert.equal(isPaused(db, alpha), true);
  assert.equal(isPaused(db, beta), false);
  assert.equal(isPaused(db), false);
  assert.throws(() => startPause(db, { projectId: alpha }), /already paused/);
  const all = startPause(db, { projectId: null });
  assert.equal(isPaused(db), true);
  assert.equal(isPaused(db, beta), true);
  endPause(db, all.pause.id);
  endPause(db, p.pause.id);
  assert.equal(isPaused(db, alpha), false);
});

test('launches are refused while paused and allowed after', async (t) => {
  const { db, desk, launch, fake } = setup(t);
  const { session: architect } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  const { pause } = startPause(db, { projectId: architect.project_id });
  await assert.rejects(launchDeveloper(launch, { architectId: architect.id, task: 'x', label: 'x' }), /alpha is paused/);
  await assert.rejects(launchArchitect(launch, { project: 'alpha', workstream: 'main', parentId: desk.id }), /paused/);
  assert.equal((await launchArchitect(launch, { project: 'beta', parentId: desk.id })).existing, false);
  const runsBefore = fake.runs.length;
  const all = startPause(db, { projectId: null });
  await assert.rejects(launchArchitect(launch, { project: 'beta', parentId: desk.id }), /everything is paused/);
  assert.equal(fake.runs.length, runsBefore);
  endPause(db, all.pause.id);
  endPause(db, pause.id);
  assert.equal((await launchDeveloper(launch, { architectId: architect.id, task: 'x', label: 'x' })).existing, false);
});

test('pause, report, finish and resume one project', async (t) => {
  const { db, desk, launch, fake, as, call } = setup(t);
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  const { session: dev } = await launchDeveloper(launch, { architectId: arch.id, task: 'login', label: 'login' });
  const { session: other } = await launchArchitect(launch, { project: 'beta', parentId: desk.id });

  const paused = await call('pause', { project: 'alpha', reason: 'dinner' });
  assert.deepEqual(paused.sessions.map((s: { name: string }) => s.name), ['mm-alpha-main', 'mm-alpha-main-dev-login']);
  const pauseItems = listItems(db, { addressedTo: dev.id });
  assert.match(pauseItems[0].body, /^PAUSE: delete your \/multi-manager:tick timer \(CronDelete\) if you have one, reach a clean point, commit WIP on your branch/);
  assert.equal(listItems(db, { addressedTo: other.id }).length, 0);

  await assert.rejects(call('finish_pause', { project: 'alpha' }), /Not reported yet: mm-alpha-main, mm-alpha-main-dev-login/);

  as(dev.id);
  await call('report_paused', { note_path: 'conductor/tracks/login/progress.md', summary: 'form half done', committed: true });
  as(arch.id);
  await call('report_paused', { note_path: 'conductor/tracks/auth/progress.md', summary: 'waiting on dev', committed: true });
  as(desk.id);
  const status = await call('pause_status', { project: 'alpha' });
  assert.deepEqual(status.not_reported, []);
  assert.equal(status.sessions[1].note_path, 'conductor/tracks/login/progress.md');

  const finished = await call('finish_pause', { project: 'alpha' });
  assert.equal(finished.confirmation, 'Nothing left running.');
  assert.deepEqual([...fake.killed].sort(), [arch.pid, dev.pid].sort());
  assert.equal(requireSession(db, other.id).state, 'running');
  await assert.rejects(launchArchitect(launch, { project: 'alpha', parentId: desk.id }), /paused/);

  const runsBefore = fake.runs.length;
  const resumed = await call('resume', { project: 'alpha' });
  assert.equal(isPaused(db, arch.project_id), false);
  assert.equal(resumed.architects.length, 1);
  assert.equal(resumed.architects[0].relaunched, true);
  assert.deepEqual(resumed.developers_not_relaunched, [{ name: 'mm-alpha-main-dev-login', note_path: 'conductor/tracks/login/progress.md', committed: true }]);
  const launched = fake.runs.slice(runsBefore);
  assert.equal(launched.length, 1);
  // The prompt now sits on the `& claude` line of the base64 wrapper script, single-quoted for PowerShell.
  const claudeLine = decodeCommand(launched[0].args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  const prompt = claudeLine.replace(/''/g, "'");
  assert.match(prompt, /conductor\/tracks\/auth\/progress\.md/);
  assert.match(prompt, /WAIT for the user's go/);
  assert.doesNotMatch(prompt, /;/);
});

test('finish_pause refuses unreported sessions unless forced, and names what still runs', async (t) => {
  const { desk, launch, fake, call } = setup(t);
  await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  await launchArchitect(launch, { project: 'beta', parentId: desk.id });
  await call('pause');
  await assert.rejects(call('finish_pause'), /Not reported yet/);
  fake.deps.ownsProcess = async (pid) => pid === 4002; // beta's claude.exe survives taskkill
  const finished = await call('finish_pause', { force: true });
  assert.deepEqual(finished.not_reported, ['mm-alpha-main', 'mm-beta-main']);
  assert.match(finished.confirmation, /^Still running: mm-beta-main \(pid 4002\)/);
});

test('resume tells a still-running architect through an item instead of relaunching it', async (t) => {
  const { db, desk, launch, fake, call } = setup(t);
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  await call('pause');
  const runsBefore = fake.runs.length;
  const resumed = await call('resume');
  assert.equal(fake.runs.length, runsBefore);
  assert.equal(resumed.architects[0].relaunched, false);
  assert.match(listItems(db, { addressedTo: arch.id }).at(-1)?.body ?? '', /No resume note was reported.*WAIT/);
});

test('only the front desk can pause, finish or resume; report_paused needs a pause', async (t) => {
  const { desk, launch, as, call } = setup(t);
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  as(arch.id);
  await assert.rejects(call('report_paused', { note_path: 'p.md', summary: 's', committed: false }), /Nothing is paused/);
  await assert.rejects(call('pause'), /Only the front desk can call pause/);
  as(desk.id);
  await call('pause', { project: 'alpha' });
  await assert.rejects(call('pause', { project: 'alpha' }), /already paused/);
  as(arch.id);
  await assert.rejects(call('finish_pause', { project: 'alpha' }), /Only the front desk/);
  await assert.rejects(call('resume', { project: 'alpha' }), /Only the front desk/);
  await call('report_paused', { note_path: 'p.md', summary: 's', committed: false });
  as(desk.id);
  assert.deepEqual((await call('pause_status', { project: 'alpha' })).not_reported, []);
  await assert.rejects(call('resume'), /No active pause for everything/);
});

test('resume relaunches an architect on its recorded model', async (t) => {
  const { db, desk, launch, fake, as, call } = setup(t);
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  setSessionModel(db, arch.id, 'opus');
  await call('pause', { project: 'alpha' });
  as(arch.id);
  await call('report_paused', { note_path: 'p.md', summary: 's', committed: true });
  as(desk.id);
  await call('finish_pause', { project: 'alpha' });
  const runsBefore = fake.runs.length;
  const resumed = await call('resume', { project: 'alpha' });
  assert.equal(resumed.architects[0].relaunched, true);
  const line = decodeCommand(fake.runs.slice(runsBefore)[0].args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  assert.match(line, /'--model' 'opus'/);
  assert.equal(requireSession(db, resumed.architects[0].session_id).model, 'opus');
});
