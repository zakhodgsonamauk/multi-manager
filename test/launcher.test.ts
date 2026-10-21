import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Command, SettingsFile } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, stopArchitect, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { claim, listClaims } from '../src/roster/claims.ts';
import { createGoal, requireGoal } from '../src/roster/goals.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function fakeDeps(overrides: Partial<LaunchDeps> = {}) {
  const calls = { run: [] as Command[], settings: [] as SettingsFile[], profile: 0 };
  const deps: LaunchDeps = {
    run: async (command) => {
      calls.run.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: (file) => {
      calls.settings.push(file);
    },
    waitForPid: async (name) => (name.includes('-dev-') ? 5151 : 4242),
    findPid: () => null,
    ownsProcess: async () => true,
    ensureTerminalProfile: () => {
      calls.profile += 1;
    },
    ...overrides,
  };
  return { deps, calls };
}

function setup(t: TestContext, deps: LaunchDeps, permissionMode?: string) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', permissionMode });
  const main = requireWorkstream(db, project.id, 'main');
  const ctx: LaunchContext = { db, deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  return { db, desk, project, main, ctx };
}

test('launching an architect opens a tab, stores the pid and moves the goal to planning', async (t) => {
  const { deps, calls } = fakeDeps();
  const { db, desk, main, ctx } = setup(t, deps);
  const goal = createGoal(db, { workstreamId: main.id, text: 'Login page' });
  const result = await launchArchitect(ctx, { project: 'alpha', goalId: goal.id, parentId: desk.id });
  assert.equal(result.existing, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.session.name, 'mm-alpha-main');
  assert.equal(result.session.pid, 4242);
  assert.equal(result.session.parent_id, desk.id);
  assert.equal(calls.profile, 1);
  const command = calls.run[0];
  assert.equal(command.file, join('C:\\L', 'Microsoft', 'WindowsApps', 'wt.exe'));
  assert.equal(command.args[command.args.indexOf('-d') + 1], 'C:\\work\\alpha');
  assert.ok(command.args.includes('--dangerously-skip-permissions'));
  assert.equal(command.args[command.args.indexOf('--append-system-prompt-file') + 1], join('I:\\mm', 'briefings', 'architect.md'));
  assert.match(command.args.at(-1) ?? '', new RegExp(`roster goal #${goal.id}`));
  const rosterDb = process.env.MM_ROSTER_DB ?? '';
  assert.equal(calls.settings[0].path, join(dirname(rosterDb), 'sessions', `${result.session.id}.settings.json`));
  assert.deepEqual(JSON.parse(calls.settings[0].content).env, {
    MM_ROLE: 'architect',
    MM_SESSION_ID: String(result.session.id),
    MM_PARENT_ID: String(desk.id),
    MM_ROSTER_DB: rosterDb,
    MM_VOICE: 'off',
  });
  assert.equal(requireGoal(db, goal.id).state, 'planning');
});

test('a running architect is returned instead of launching another', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const first = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const second = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(second.existing, true);
  assert.equal(second.session.id, first.session.id);
  assert.equal(calls.run.length, 1);
});

test('a failed launch is marked stopped and can be retried', async (t) => {
  let fail = true;
  const { deps } = fakeDeps({ run: async () => (fail ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' }) });
  const { db, desk, ctx } = setup(t, deps);
  await assert.rejects(launchArchitect(ctx, { project: 'alpha', parentId: desk.id }), /Windows Terminal launch failed \(exit 1\): boom/);
  const failed = requireSession(db, 2);
  assert.equal(failed.state, 'stopped');
  fail = false;
  assert.equal((await launchArchitect(ctx, { project: 'alpha', parentId: desk.id })).existing, false);
});

test('a project with another permission mode launches without the flag and warns', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps, 'default');
  const result = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.ok(!calls.run[0].args.includes('--dangerously-skip-permissions'));
  assert.match(result.warnings[0], /held for your approval/);
});

test('a missing pid is a warning, not a failure', async (t) => {
  const { deps } = fakeDeps({ waitForPid: async () => null });
  const { desk, ctx } = setup(t, deps);
  const result = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(result.session.pid, null);
  assert.match(result.warnings[0], /process id was not found/);
});

test('a goal from another workstream is refused', async (t) => {
  const { deps } = fakeDeps();
  const { db, desk, project, ctx } = setup(t, deps);
  db.prepare("INSERT INTO workstreams (project_id, name, branch) VALUES (?, 'ui', 'feature/ui')").run(project.id);
  const goal = createGoal(db, { workstreamId: requireWorkstream(db, project.id, 'ui').id, text: 'x' });
  await assert.rejects(launchArchitect(ctx, { project: 'alpha', goalId: goal.id, parentId: desk.id }), /does not belong to alpha\/main/);
});

test('stopping kills the process tree, marks stopped and releases claims', async (t) => {
  const { deps, calls } = fakeDeps();
  const { db, desk, project, ctx } = setup(t, deps);
  const { session } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  claim(db, project.id, 'package.json', session.id);
  const stopped = await stopArchitect(ctx, { project: 'alpha' });
  assert.equal(stopped.killed, true);
  assert.deepEqual(calls.run[1], { file: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
  assert.equal(stopped.session.state, 'stopped');
  assert.deepEqual(listClaims(db, project.id), []);
  await assert.rejects(stopArchitect(ctx, { project: 'alpha' }), /No running architect for alpha\/main/);
});

test('stop never kills a process it does not own', async (t) => {
  const { deps, calls } = fakeDeps({ ownsProcess: async () => false });
  const { desk, ctx } = setup(t, deps);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const stopped = await stopArchitect(ctx, { project: 'alpha' });
  assert.equal(stopped.killed, false);
  assert.equal(calls.run.length, 1);
  assert.match(stopped.warnings.join('\n'), /nothing was killed/);
  assert.equal(stopped.session.state, 'stopped');
});

test('architects launch developer tabs in their own worktree; stopping the architect stops them first', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const { session: architect } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const dev = await launchDeveloper(ctx, { architectId: architect.id, task: 'Build the login form', label: 'login' });
  assert.equal(dev.session.role, 'developer');
  assert.equal(dev.session.parent_id, architect.id);
  assert.equal(dev.session.name, 'mm-alpha-main-dev-login');
  const devArgs = calls.run[1].args;
  assert.equal(devArgs[devArgs.indexOf('--worktree') + 1], 'mm-alpha-main-dev-login');
  assert.equal(devArgs[devArgs.indexOf('--append-system-prompt-file') + 1], join('I:\\mm', 'briefings', 'developer.md'));
  await stopArchitect(ctx, { project: 'alpha' });
  assert.deepEqual(calls.run.slice(2).map((c) => c.args[1]), ['5151', '4242']);
});
