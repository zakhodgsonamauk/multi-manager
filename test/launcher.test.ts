import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Command, SettingsFile } from '../src/launch/command.ts';
import { CODE_GRAPH_SERVER_SPEC } from '../src/codegraph/codegraph.ts';
import { launchArchitect, launchDeveloper, launchProjectManager, stopArchitect, stopProjectManager, type LaunchContext } from '../src/launch/launcher.ts';
import type { DevCopyInput } from '../src/launch/dev-copy.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand, wrapperMarker } from '../src/launch/wrapper.ts';
import { claim, listClaims } from '../src/roster/claims.ts';
import { createGoal, requireGoal } from '../src/roster/goals.ts';
import { addProject, requireWorkstream, setCodeGraph } from '../src/roster/projects.ts';
import { requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

/** The claude arguments inside the wrapper script that wt.exe is given (last argument, base64). */
function claudeArgsOf(command: Command): string[] {
  const line = decodeCommand(command.args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  return [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

function fakeDeps(overrides: Partial<LaunchDeps> = {}) {
  const calls = { copies: [] as DevCopyInput[], run: [] as Command[], settings: [] as SettingsFile[], profile: 0, removed: [] as string[][], markers: [] as string[] };
  const deps: LaunchDeps = {
    run: async (command) => {
      calls.run.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: (file) => {
      calls.settings.push(file);
    },
    waitForPid: async (name) => (name.includes('-dev-') ? 5151 : 4242),
    findPid: async () => null,
    ownsProcess: async () => true,
    waitForWrapperPid: async (path) => (/[\\/]3\.wrapper\.pid$/.test(path) ? 6161 : 7272),
    readWrapperPid: () => null,
    ownsWrapper: async (_pid, marker) => {
      calls.markers.push(marker);
      return true;
    },
    removeFiles: (paths) => {
      calls.removed.push(paths);
    },
    ensureTerminalProfile: () => {
      calls.profile += 1;
    },
    ensureDevCopy: (input) => {
      calls.copies.push(input);
      return join(input.projectFolder, '.claude', 'worktrees', input.name);
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
  assert.equal(result.session.wrapper_pid, 7272);
  assert.equal(result.session.parent_id, desk.id);
  assert.equal(calls.profile, 1);
  const command = calls.run[0];
  assert.equal(command.file, join('C:\\L', 'Microsoft', 'WindowsApps', 'wt.exe'));
  assert.equal(command.args[command.args.indexOf('-d') + 1], 'C:\\work\\alpha');
  const claude = claudeArgsOf(command);
  assert.ok(claude.includes('--dangerously-skip-permissions'));
  assert.equal(claude[claude.indexOf('--append-system-prompt-file') + 1], join('I:\\mm', 'briefings', 'architect.md'));
  assert.match(claude.at(-1) ?? '', new RegExp(`roster goal #${goal.id}`));
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
  assert.ok(!claudeArgsOf(calls.run[0]).includes('--dangerously-skip-permissions'));
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
  assert.deepEqual(calls.run[1], { file: 'taskkill', args: ['/PID', '7272', '/T', '/F'] });
  const rosterDb = process.env.MM_ROSTER_DB ?? '';
  assert.deepEqual(calls.markers, [wrapperMarker(session.id, rosterDb)]);
  const dir = join(dirname(rosterDb), 'sessions');
  assert.deepEqual(calls.removed.at(-1), [`${session.id}.settings.json`, `${session.id}.mcp.json`, `${session.id}.wrapper.pid`, `${session.id}.exit`].map((f) => join(dir, f)));
  assert.equal(stopped.session.state, 'stopped');
  assert.deepEqual(listClaims(db, project.id), []);
  await assert.rejects(stopArchitect(ctx, { project: 'alpha' }), /No running architect for alpha\/main/);
});

test('stop_architect can name the session id instead of project and workstream', async (t) => {
  const { deps } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const { session } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const stopped = await stopArchitect(ctx, { sessionId: session.id });
  assert.equal(stopped.session.state, 'stopped');
  await assert.rejects(stopArchitect(ctx, { sessionId: session.id }), /not running/);
  await assert.rejects(stopArchitect(ctx, { sessionId: desk.id }), /not an architect/);
  await assert.rejects(stopArchitect(ctx, {}), /session_id/);
});

test('stop never kills a process it does not own', async (t) => {
  const { deps, calls } = fakeDeps({ ownsProcess: async () => false, ownsWrapper: async () => false });
  const { desk, ctx } = setup(t, deps);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const stopped = await stopArchitect(ctx, { project: 'alpha' });
  assert.equal(stopped.killed, false);
  assert.equal(calls.run.length, 1);
  assert.match(stopped.warnings.join('\n'), /nothing was killed/);
  assert.equal(stopped.session.state, 'stopped');
});

test('a wrapper that is not ours falls back to the claude.exe ownership check', async (t) => {
  const { deps, calls } = fakeDeps({ ownsWrapper: async () => false });
  const { desk, ctx } = setup(t, deps);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const stopped = await stopArchitect(ctx, { project: 'alpha' });
  assert.equal(stopped.killed, true);
  assert.deepEqual(calls.run[1].args, ['/PID', '4242', '/T', '/F']);
  assert.match(stopped.warnings.join('\n'), /7272 is not mm-alpha-main's wrapper/);
});

test('without a recorded wrapper pid, stop reads the .wrapper.pid file', async (t) => {
  const { deps, calls } = fakeDeps({ waitForWrapperPid: async () => null, readWrapperPid: () => 8383 });
  const { desk, ctx } = setup(t, deps);
  const launched = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(launched.session.wrapper_pid, null);
  assert.match(launched.warnings.join('\n'), /wrapper did not report/);
  await stopArchitect(ctx, { project: 'alpha' });
  assert.deepEqual(calls.run[1].args, ['/PID', '8383', '/T', '/F']);
});

test('launch clears stale wrapper state files for the new session first', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const { session } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.deepEqual(calls.removed[0].map((p) => p.split(/[\\/]/).at(-1)), [`${session.id}.mcp.json`, `${session.id}.wrapper.pid`, `${session.id}.exit`]);
});

test('architects launch developer tabs in their own worktree; stopping the architect stops them first', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const { session: architect } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const dev = await launchDeveloper(ctx, { architectId: architect.id, task: 'Build the login form', label: 'login' });
  assert.equal(dev.session.role, 'developer');
  assert.equal(dev.session.parent_id, architect.id);
  assert.equal(dev.session.name, 'mm-alpha-main-dev-login');
  const devArgs = claudeArgsOf(calls.run[1]);
  assert.ok(!devArgs.includes('--worktree'), 'the launcher makes the copy itself');
  assert.deepEqual(calls.copies, [{ projectFolder: 'C:\\work\\alpha', name: 'mm-alpha-main-dev-login', baseBranch: 'main' }]);
  const tab = calls.run[1];
  const copyFolder = join('C:\\work\\alpha', '.claude', 'worktrees', 'mm-alpha-main-dev-login');
  assert.equal(tab.args[tab.args.indexOf('-d') + 1], copyFolder, 'the tab opens in the copy');
  assert.ok(decodeCommand(tab.args.at(-1) ?? '').includes(`Set-Location -LiteralPath '${copyFolder}'`));
  assert.equal(dev.session.folder, 'C:\\work\\alpha', 'the recorded folder stays the project folder');
  assert.equal(devArgs[devArgs.indexOf('--append-system-prompt-file') + 1], join('I:\\mm', 'briefings', 'developer.md'));
  await stopArchitect(ctx, { project: 'alpha' });
  assert.deepEqual(calls.run.slice(2).map((c) => c.args[1]), ['6161', '7272']);
});

test('a developer whose copy cannot be made opens no tab and ends stopped', async (t) => {
  const { deps, calls } = fakeDeps({
    ensureDevCopy: () => {
      throw new Error('Branch "main" does not exist');
    },
  });
  const { db, desk, ctx } = setup(t, deps);
  const { session: architect } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  await assert.rejects(launchDeveloper(ctx, { architectId: architect.id, task: 'x', label: 'login' }), /Branch "main" does not exist/);
  assert.equal(calls.run.length, 1, 'only the architect tab was opened');
  const dev = db.prepare("SELECT state FROM sessions WHERE role = 'developer'").all() as { state: string }[];
  assert.ok(dev.every((row) => row.state === 'stopped'));
});

test('architect launches make no copy', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.deepEqual(calls.copies, []);
});

test('a developer for a code-graph project gets a .mcp.json pointing at the project folder; the launch passes it', async (t) => {
  const { deps, calls } = fakeDeps();
  const { db, desk, ctx } = setup(t, deps);
  setCodeGraph(db, 'alpha', true);
  const { session: architect } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const dev = await launchDeveloper(ctx, { architectId: architect.id, task: 'x', label: 'login' });
  const path = join(dirname(process.env.MM_ROSTER_DB ?? ''), 'sessions', `${dev.session.id}.mcp.json`);
  const written = calls.settings.filter((f) => f.path === path);
  assert.equal(written.length, 1);
  const spec = JSON.parse(CODE_GRAPH_SERVER_SPEC) as { env: Record<string, string> };
  assert.deepEqual(JSON.parse(written[0].content), {
    mcpServers: { 'code-review-graph': { ...spec, env: { ...spec.env, CRG_REPO_ROOT: 'C:\\work\\alpha' } } },
  });
  const args = claudeArgsOf(calls.run[1]);
  assert.equal(args[args.indexOf('--mcp-config') + 1], path);
  assert.ok(!args.includes('--strict-mcp-config'));
});

test('with code_graph off no .mcp.json is written and no flag is passed', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const { session: architect } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  await launchDeveloper(ctx, { architectId: architect.id, task: 'x', label: 'login' });
  assert.ok(!calls.settings.some((f) => f.path.endsWith('.mcp.json')));
  assert.ok(!claudeArgsOf(calls.run[1]).includes('--mcp-config'));
});

test('architects and project managers never get the .mcp.json, even with code_graph on', async (t) => {
  const { deps, calls } = fakeDeps();
  const { db, desk, ctx } = setup(t, deps);
  setCodeGraph(db, 'alpha', true);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  await launchProjectManager(ctx, { project: 'alpha', parentId: desk.id });
  assert.ok(!calls.settings.some((f) => f.path.endsWith('.mcp.json')));
  for (const run of calls.run) assert.ok(!claudeArgsOf(run).includes('--mcp-config'));
});

test('stopping a session removes its .mcp.json along with the other state files', async (t) => {
  const { deps, calls } = fakeDeps();
  const { db, desk, ctx } = setup(t, deps);
  setCodeGraph(db, 'alpha', true);
  const { session: architect } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const dev = await launchDeveloper(ctx, { architectId: architect.id, task: 'x', label: 'login' });
  await stopArchitect(ctx, { project: 'alpha' });
  const mcp = join(dirname(process.env.MM_ROSTER_DB ?? ''), 'sessions', `${dev.session.id}.mcp.json`);
  assert.ok(calls.removed.slice(1).some((paths) => paths.includes(mcp)), 'removed on stop');
});

function graphSpy(ensure?: () => Promise<never>) {
  const calls: string[] = [];
  const codeGraph: NonNullable<LaunchDeps['codeGraph']> = {
    ensureWatcher: async (p) => {
      calls.push(`ensure ${p.folder}`);
      if (ensure !== undefined) return ensure();
      return { ok: true };
    },
    releaseWatcher: async (p, still) => {
      calls.push(`release ${p.folder} ${String(still)}`);
      return { ok: true };
    },
    pruneStaleGraphData: () => {
      calls.push('prune');
    },
  };
  return { calls, codeGraph };
}

test('an "on" project: launching an architect and a project manager starts the watcher', async (t) => {
  const spy = graphSpy();
  const { deps } = fakeDeps({ codeGraph: spy.codeGraph });
  const { db, desk, ctx } = setup(t, deps);
  setCodeGraph(db, 'alpha', true);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  await launchProjectManager(ctx, { project: 'alpha', parentId: desk.id });
  assert.deepEqual(spy.calls, ['ensure C:\\work\\alpha', 'ensure C:\\work\\alpha']);
});

test('an "on" project: stopping the last one releases the watcher, an architect stop prunes; an earlier stop keeps it', async (t) => {
  const spy = graphSpy();
  const { deps } = fakeDeps({ codeGraph: spy.codeGraph });
  const { db, desk, ctx } = setup(t, deps);
  setCodeGraph(db, 'alpha', true);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const pm = await launchProjectManager(ctx, { project: 'alpha', parentId: desk.id });
  spy.calls.length = 0;
  await stopProjectManager(ctx, { project: 'alpha' });
  assert.deepEqual(spy.calls, ['release C:\\work\\alpha true']);
  spy.calls.length = 0;
  await stopArchitect(ctx, { project: 'alpha' });
  assert.deepEqual(spy.calls, ['release C:\\work\\alpha false', 'prune']);
  assert.equal(requireSession(db, pm.session.id).state, 'stopped');
});

test('an "off" project runs none of the watcher steps', async (t) => {
  const spy = graphSpy();
  const { deps } = fakeDeps({ codeGraph: spy.codeGraph });
  const { desk, ctx } = setup(t, deps);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  await stopArchitect(ctx, { project: 'alpha' });
  assert.deepEqual(spy.calls, []);
});

test('a failing watcher step never blocks a launch or a stop', async (t) => {
  const spy = graphSpy(() => Promise.reject(new Error('daemon exploded')));
  spy.codeGraph.releaseWatcher = () => Promise.reject(new Error('stop exploded'));
  spy.codeGraph.pruneStaleGraphData = () => {
    throw new Error('prune exploded');
  };
  const { deps } = fakeDeps({ codeGraph: spy.codeGraph });
  const { db, desk, ctx } = setup(t, deps);
  setCodeGraph(db, 'alpha', true);
  const launched = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(launched.existing, false);
  const stopped = await stopArchitect(ctx, { project: 'alpha' });
  assert.equal(stopped.session.state, 'stopped');
});
