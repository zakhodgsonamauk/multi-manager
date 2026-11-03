import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Command } from '../src/launch/command.ts';
import {
  launchArchitect,
  launchDeveloper,
  launchProjectManager,
  restartArchitect,
  stopProjectManager,
  type LaunchContext,
} from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import type { ActivityReaders } from '../src/monitor/activity.ts';
import { detectDeaths } from '../src/monitor/monitor.ts';
import { detectStuck } from '../src/monitor/health.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { createGoal } from '../src/roster/goals.ts';
import { listItems } from '../src/roster/items.ts';
import { addProject, getWorkstream } from '../src/roster/projects.ts';
import { requireSession, runningChildren, setSessionModel, startFrontDesk } from '../src/roster/sessions.ts';
import { registerPauseTools } from '../src/roster/tools-pause.ts';
import { registerRecoveryTools } from '../src/roster/tools-recovery.ts';
import { briefing, registerRosterTools, type ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function claudeArgsOf(command: Command): string[] {
  const line = decodeCommand(command.args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  return [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}
const argAfter = (command: Command, flag: string): string | undefined => {
  const args = claudeArgsOf(command);
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};
/** The session environment written for the latest launch. */
const envOf = (fake: { settings: { content: string }[] }): Record<string, string> => JSON.parse(fake.settings.at(-1)!.content).env;

/** Nothing real is launched or killed. A process is "alive" until taskkill names it. */
function fakeDeps() {
  const runs: Command[] = [];
  const killed = new Set<number>();
  const settings: { content: string }[] = [];
  let nextPid = 4000;
  const deps: LaunchDeps = {
    run: async (command) => {
      runs.push(command);
      if (command.file === 'taskkill') killed.add(Number(command.args[1]));
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: (file) => void settings.push(file),
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
  return { deps, runs, killed, settings };
}

const readers: ActivityReaders = { readSessionFile: () => null, findTranscript: () => null, mtimeMs: () => null };
const afterReboot = async (): Promise<ProcessInfo[]> => [{ pid: 1, ppid: 0, name: 'System', created: 0, commandLine: null }];

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', workstreams: [{ name: 'api', branch: 'main' }] });
  addProject(db, { name: 'beta', folder: 'C:\\work\\beta' });
  const fake = fakeDeps();
  const launch: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const ctx: ToolContext = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: 'I:\\mm', launch };
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler) } as unknown as McpServer;
  registerPauseTools(server, ctx);
  registerRecoveryTools(server, ctx, { snapshot: afterReboot, readers });
  registerRosterTools(server, ctx);
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

test('launch_project_manager: pm workstream created, opus, its briefing, MM_ROLE, parent is the front desk', async (t) => {
  const { db, desk, fake, call } = setup(t);
  assert.equal(getWorkstream(db, 1, 'pm'), undefined);
  const result = await call('launch_project_manager', { project: 'alpha' });
  assert.equal(result.existing, false);
  const pm = requireSession(db, result.session.id);
  assert.equal(pm.role, 'project-manager');
  assert.equal(pm.parent_id, desk.id);
  assert.equal(pm.model, 'opus');
  assert.equal(pm.workstream_id, getWorkstream(db, 1, 'pm')?.id);
  const command = fake.runs.at(-1)!;
  assert.equal(argAfter(command, '--model'), 'opus');
  assert.match(argAfter(command, '--append-system-prompt-file') ?? '', /briefings[\\/]project-manager\.md$/);
  assert.equal(envOf(fake).MM_ROLE, 'project-manager');
  assert.equal(envOf(fake).MM_PARENT_ID, String(desk.id));
  console.log(`CAPTURED PM LAUNCH: --model ${argAfter(command, '--model')}; briefing ${argAfter(command, '--append-system-prompt-file')}; MM_ROLE=${envOf(fake).MM_ROLE}`);
});

test('a second launch while one runs returns the running one; other projects are separate', async (t) => {
  const { fake, call } = setup(t);
  const first = await call('launch_project_manager', { project: 'alpha' });
  const runs = fake.runs.length;
  const second = await call('launch_project_manager', { project: 'alpha' });
  assert.equal(second.existing, true);
  assert.equal(second.session.id, first.session.id);
  assert.equal(fake.runs.length, runs);
  assert.equal((await call('launch_project_manager', { project: 'beta' })).existing, false);
});

test('only the front desk can launch a project manager', async (t) => {
  const { launch, db, desk, as, call } = setup(t);
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  as(arch.id);
  await assert.rejects(call('launch_project_manager', { project: 'alpha' }), /Only the front desk can launch a project manager/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE role = 'project-manager'").get()?.n, 0);
});

test('a recorded model (step-down) wins when the project manager is relaunched; a goal id is named in the start prompt', async (t) => {
  const { db, desk, launch, fake } = setup(t);
  const first = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  await stopProjectManager(launch, { project: 'alpha' });
  setSessionModel(db, first.session.id, 'sonnet');
  await restartArchitect(launch, { sessionId: first.session.id, reason: 'a crash' });
  assert.equal(argAfter(fake.runs.at(-1)!, '--model'), 'sonnet');
  await stopProjectManager(launch, { project: 'alpha' });
  const goal =createGoal(db, { workstreamId: first.session.workstream_id as number, text: 'manage' });
  const again = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id, goalId: goal.id });
  assert.equal(again.existing, false);
  const prompt = claudeArgsOf(fake.runs.at(-1)!).at(-1) ?? '';
  assert.match(prompt, /project manager for project alpha/);
  assert.match(prompt, new RegExp(`roster goal #${goal.id}`));
});

test('architects a project manager launches are its children', async (t) => {
  const { db, desk, launch, call, as } = setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  as(pm.id);
  const result = await call('launch_architect', { project: 'alpha', workstream: 'api' });
  assert.equal(requireSession(db, result.session.id).parent_id, pm.id);
});

test('stop_project_manager stops the project manager and, as today, its running children', async (t) => {
  const { db, desk, launch, call } = setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', workstream: 'api', parentId: pm.id });
  const { session: dev } = await launchDeveloper(launch, { architectId: arch.id, task: 'x', label: 'x' });
  await call('stop_project_manager', { project: 'alpha' });
  for (const s of [pm, arch, dev]) assert.equal(requireSession(db, s.id).state, 'stopped');
  await assert.rejects(call('stop_project_manager', { project: 'alpha' }), /No running project manager/);
});

test('restart_architect takes a project manager (same row, recorded model, its briefing) and still refuses a developer', async (t) => {
  const { db, desk, launch, fake, call } = setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id, model: 'sonnet' });
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', workstream: 'api', parentId: pm.id });
  const { session: dev } = await launchDeveloper(launch, { architectId: arch.id, task: 'x', label: 'x' });
  await assert.rejects(call('restart_architect', { session_id: dev.id }), /not an architect or project manager/);
  await stopProjectManager(launch, { project: 'alpha' });
  const result = await call('restart_architect', { session_id: pm.id, reason: 'a crash' });
  assert.equal(result.session_id, pm.id);
  assert.equal(requireSession(db, pm.id).state, 'running');
  const command = fake.runs.at(-1)!;
  assert.equal(argAfter(command, '--model'), 'sonnet');
  assert.match(argAfter(command, '--append-system-prompt-file') ?? '', /project-manager\.md$/);
  assert.equal(envOf(fake).MM_ROLE, 'project-manager');
  assert.equal(requireSession(db, arch.id).parent_id, pm.id, 'its architects are still its children');
  assert.match(claudeArgsOf(command).at(-1) ?? '', /restarted after a crash/);
});

test('get_briefing returns briefings/project-manager.md', () => {
  const result = briefing(fileURLToPath(new URL('..', import.meta.url)), 'project-manager');
  assert.match(result.path, /project-manager\.md$/);
  assert.match(result.text, /Project manager/);
});

/** Everything down, as after a reboot: stopped rows plus the monitor's death items. */
async function crashAll(t: TestContext) {
  const s = setup(t);
  const { session: pm } = await launchProjectManager(s.launch, { project: 'alpha', parentId: s.desk.id });
  const { session: arch } = await launchArchitect(s.launch, { project: 'alpha', workstream: 'api', parentId: pm.id });
  const { session: dev } = await launchDeveloper(s.launch, { architectId: arch.id, task: 'x', label: 'x' });
  detectDeaths(s.db, await afterReboot());
  return { ...s, pm, arch, dev };
}

test('restorable_sessions nests architects under their project manager and developers under them; restore_all brings the project manager back first', async (t) => {
  const { db, call, fake, pm, arch, dev } = await crashAll(t);
  const list = await call('restorable_sessions');
  assert.deepEqual(list.project_managers.map((p: { session_id: number }) => p.session_id), [pm.id]);
  assert.deepEqual(list.project_managers[0].architects.map((a: { session_id: number }) => a.session_id), [arch.id]);
  assert.deepEqual(list.project_managers[0].architects[0].developers.map((d: { session_id: number }) => d.session_id), [dev.id]);
  assert.deepEqual(list.architects, [], 'nested ones are not listed twice');

  const before = fake.runs.length;
  const done = await call('restore_all');
  assert.deepEqual(done.restored.map((r: { session_id: number }) => r.session_id), [pm.id, arch.id]);
  const names = fake.runs.slice(before).map((r) => r.args.join(' ')).filter((a) => a.includes('--title'));
  assert.match(names[0], /project-manager/);
  assert.equal(requireSession(db, arch.id).parent_id, pm.id);
  assert.equal(requireSession(db, pm.id).state, 'running');
  assert.equal(requireSession(db, dev.id).state, 'stopped', 'developers are not restarted');
});

test('finish_pause closes the project manager first; resume relaunches it first and parents the architects to the new session', async (t) => {
  const { db, desk, launch, fake, as, call } = setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', workstream: 'api', parentId: pm.id });
  const { session: other } = await launchArchitect(launch, { project: 'beta', parentId: desk.id });
  await call('pause', { project: 'alpha' });
  for (const s of [pm, arch]) {
    as(s.id);
    await call('report_paused', { note_path: 'p.md', summary: 'ok', committed: true });
  }
  as(desk.id);
  const finished = await call('finish_pause', { project: 'alpha' });
  assert.equal(finished.confirmation, 'Nothing left running.');
  const kills = fake.runs.filter((r) => r.file === 'taskkill').map((r) => Number(r.args[1]));
  assert.ok(kills.indexOf(requireSession(db, arch.id).pid as number) < kills.indexOf(requireSession(db, pm.id).pid as number), 'children go before the manager that owns them');
  assert.equal(requireSession(db, other.id).state, 'running');

  const resumed = await call('resume', { project: 'alpha' });
  assert.equal(resumed.project_managers.length, 1);
  assert.equal(resumed.project_managers[0].relaunched, true);
  const newPm = requireSession(db, resumed.project_managers[0].session_id);
  assert.equal(newPm.role, 'project-manager');
  assert.equal(newPm.parent_id, desk.id);
  assert.equal(resumed.architects.length, 1);
  assert.equal(requireSession(db, resumed.architects[0].session_id).parent_id, newPm.id);
  assert.deepEqual(runningChildren(db, newPm.id).map((s) => s.role), ['architect']);
});

test('a project without a project manager pauses and resumes as before: architects go under the front desk', async (t) => {
  const { db, desk, launch, as, call } = setup(t);
  const { session: arch } = await launchArchitect(launch, { project: 'beta', parentId: desk.id });
  await call('pause', { project: 'beta' });
  as(arch.id);
  await call('report_paused', { note_path: 'p.md', summary: 'ok', committed: true });
  as(desk.id);
  await call('finish_pause', { project: 'beta' });
  const resumed = await call('resume', { project: 'beta' });
  assert.deepEqual(resumed.project_managers, []);
  assert.equal(requireSession(db, resumed.architects[0].session_id).parent_id, desk.id);
});

test('monitor: a dead or stuck architect under a running project manager raises to it; a dead or stuck project manager raises to the front desk', async (t) => {
  const { db, desk, launch } = setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', workstream: 'api', parentId: pm.id });
  const { session: loose } = await launchArchitect(launch, { project: 'beta', parentId: desk.id });
  const alive = (...ids: number[]): ProcessInfo[] =>
    ids.map((id) => ({ pid: requireSession(db, id).pid as number, ppid: 0, name: 'claude.exe', created: 1, commandLine: null }));

  // Stuck: both unfinished and quiet for hours.
  createGoal(db, { workstreamId: arch.workstream_id as number, text: 'a' });
  db.prepare("UPDATE goals SET state = 'in-progress'").run();
  const later = new Date(Date.now() + 5 * 3_600_000);
  const stuck = detectStuck(db, readers, later);
  const to = (sessionId: number) => listItems(db, { states: ['open'] }).find((i) => i.id === stuck.find((r) => r.session_id === sessionId)?.item_id)?.addressed_to;
  assert.equal(to(arch.id), pm.id);
  const pmWorkstreamGoal = createGoal(db, { workstreamId: pm.workstream_id as number, text: 'pm' });
  db.prepare('UPDATE goals SET state = ? WHERE id = ?').run('in-progress', pmWorkstreamGoal.id);
  const stuckPm = detectStuck(db, readers, new Date(later.getTime() + 1000));
  assert.equal(listItems(db, { states: ['open'] }).find((i) => i.id === stuckPm.find((r) => r.session_id === pm.id)?.item_id)?.addressed_to, desk.id);

  // Dead: only the loose architect and the project manager's architect are gone; the manager lives.
  const deaths = detectDeaths(db, alive(pm.id));
  const item = (id: number) => listItems(db, { states: ['open'] }).find((i) => i.id === deaths.find((d) => d.session_id === id)?.item_id)?.addressed_to;
  assert.equal(item(arch.id), pm.id);
  assert.equal(item(loose.id), desk.id, 'with no running project manager: unchanged');
  // Now the manager dies: front desk.
  const more = detectDeaths(db, []);
  assert.equal(listItems(db, { states: ['open'] }).find((i) => i.id === more.find((d) => d.session_id === pm.id)?.item_id)?.addressed_to, desk.id);
});

test('restore_all: when the project manager is replaced, its architects go under the running one and it says so', async (t) => {
  const { call, launch, desk, db, arch, pm } = await crashAll(t);
  const { session: newer } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const done = await call('restore_all');
  assert.deepEqual(done.skipped.map((s: { session_id: number }) => s.session_id), [pm.id]);
  assert.deepEqual(done.restored.map((r: { session_id: number }) => r.session_id), [arch.id]);
  assert.equal(requireSession(db, arch.id).parent_id, newer.id);
  assert.deepEqual(done.reparented.map((r: { session_id: number; parent: string }) => [r.session_id, r.parent]), [[arch.id, newer.name]]);
});

test('restore_all: when the project manager cannot be relaunched, its architects go under the front desk', async (t) => {
  const { call, launch, desk, db, arch, pm } = await crashAll(t);
  const realRun = launch.deps.run;
  let failed = false;
  launch.deps.run = async (command) => {
    if (!failed && command.file !== 'taskkill') {
      failed = true;
      return { code: 1, stdout: '', stderr: 'no terminal' };
    }
    return realRun(command);
  };
  const done = await call('restore_all');
  assert.deepEqual(done.skipped.map((s: { session_id: number }) => s.session_id), [pm.id]);
  assert.equal(requireSession(db, pm.id).state, 'stopped');
  assert.equal(requireSession(db, arch.id).parent_id, desk.id);
  assert.equal(done.reparented[0].parent, desk.name);
});

test('resume: a project manager that was not running at pause time is not relaunched; its architects go under the front desk', async (t) => {
  const { db, desk, launch, as, call } = setup(t);
  const { session: pm } = await launchProjectManager(launch, { project: 'alpha', parentId: desk.id });
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', workstream: 'api', parentId: pm.id });
  await stopProjectManager(launch, { project: 'alpha' }); // takes the architect down too
  const { session: arch2 } = await launchArchitect(launch, { project: 'alpha', workstream: 'api', parentId: pm.id });
  await call('pause', { project: 'alpha' });
  as(arch2.id);
  await call('report_paused', { note_path: 'p.md', summary: 'ok', committed: true });
  as(desk.id);
  await call('finish_pause', { project: 'alpha' });
  const resumed = await call('resume', { project: 'alpha' });
  assert.deepEqual(resumed.project_managers, []);
  assert.equal(requireSession(db, resumed.architects[0].session_id).parent_id, desk.id);
  assert.equal(requireSession(db, arch.id).state, 'stopped');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE role = 'project-manager' AND state = 'running'").get()?.n, 0);
});
