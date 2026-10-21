import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { RunResult } from '../src/launch/runner.ts';
import { acquireLease, detectDeaths, monitoredSessions, runTick, startMonitor, type MonitorDeps } from '../src/monitor/monitor.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { claim, listClaims } from '../src/roster/claims.ts';
import { listItems } from '../src/roster/items.ts';
import { getLimits, setLimits } from '../src/roster/limits.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, requireSession, setSessionState, startFrontDesk } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function proc(pid: number, ppid: number, name: string, created: number): ProcessInfo {
  return { pid, ppid, name, created, commandLine: null };
}

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main', pid: 10 });
  const dev = registerSession(db, { role: 'developer', parentId: arch.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main-dev-x', pid: 20 });
  return { db, desk, project, arch, dev };
}

function fakeDeps(snapshots: ProcessInfo[][]): MonitorDeps & { killed: number[] } {
  const killed: number[] = [];
  let i = 0;
  return {
    killed,
    snapshot: () => Promise.resolve(snapshots[Math.min(i++, snapshots.length - 1)]),
    kill: (pid): Promise<RunResult> => {
      killed.push(pid);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    },
    selfPid: 1,
  };
}

const base = [proc(1, 0, 'node.exe', 0), proc(10, 1, 'claude.exe', 100), proc(20, 1, 'claude.exe', 200)];

test('a vanished developer is marked stopped and its architect gets one blocked item, never two', (t) => {
  const { db, arch, dev, project } = setup(t);
  claim(db, project.id, 'src/a.ts', dev.id);
  const snap = base.filter((p) => p.pid !== 20);
  const deaths = detectDeaths(db, snap);
  assert.deepEqual(deaths.map((d) => [d.session_id, d.reason]), [[dev.id, 'gone']]);
  assert.equal(requireSession(db, dev.id).state, 'stopped');
  assert.equal(requireSession(db, arch.id).state, 'running');
  const items = listItems(db, { addressedTo: arch.id });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'blocked');
  assert.match(items[0].body, /died unexpectedly/);
  assert.match(items[0].body, /Released its 1 claim/);
  assert.equal(listClaims(db, project.id).length, 0);

  assert.deepEqual(detectDeaths(db, snap), []);
  // Even if something flips the row back to running with the same pid, the same death is not raised again.
  setSessionState(db, dev.id, 'running');
  assert.deepEqual(detectDeaths(db, snap), []);
  assert.equal(listItems(db, { addressedTo: arch.id }).length, 1);
});

test('a dead architect is reported to the front desk; a stopped session is ignored', (t) => {
  const { db, desk, arch, dev } = setup(t);
  setSessionState(db, dev.id, 'stopped');
  const deaths = detectDeaths(db, [proc(1, 0, 'node.exe', 0)]);
  assert.deepEqual(deaths.map((d) => d.session_id), [arch.id]);
  assert.equal(listItems(db, { addressedTo: desk.id }).length, 1);
});

test('a session whose pid now belongs to a newer process is reported dead (pid reuse)', (t) => {
  const { db, dev } = setup(t);
  assert.deepEqual(detectDeaths(db, base), []);
  const reused = [...base.filter((p) => p.pid !== 20), proc(20, 1, 'notepad.exe', 9999)];
  assert.deepEqual(detectDeaths(db, reused).map((d) => [d.session_id, d.reason]), [[dev.id, 'pid-reused']]);
});

test('the front desk and sessions without a pid are never monitored', (t) => {
  const { db, project } = setup(t);
  registerSession(db, { role: 'developer', projectId: project.id, name: 'helper' });
  assert.deepEqual(monitoredSessions(db).map((s) => s.root_pid), [10, 20]);
});

test('a monitor tick kills over-cap processes in the session tree and tells the parent', async (t) => {
  const { db, arch, project } = setup(t);
  setLimits(db, project.id, { sessionBinaryCaps: { 'godot.exe': 2 } });
  const snap = [...base, proc(21, 20, 'godot.exe', 300), proc(22, 20, 'godot.exe', 400), proc(23, 20, 'godot.exe', 500), proc(30, 1, 'godot.exe', 900)];
  const deps = fakeDeps([snap]);
  const result = await runTick(db, deps);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(deps.killed, [23]);
  assert.equal(result.enforcements.length, 1);
  const items = listItems(db, { addressedTo: arch.id });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'info');
  assert.match(items[0].body, /3 godot\.exe processes in session #\d+ \(mm-alpha-main-dev-x\), cap 2/);
  assert.match(items[0].body, /godot\.exe \(pid 23\)/);
});

test('a tick with an empty or failing snapshot changes nothing', async (t) => {
  const { db, dev } = setup(t);
  const empty = await runTick(db, fakeDeps([[]]));
  assert.match(empty.errors[0], /Empty process snapshot/);
  const failing = await runTick(db, { ...fakeDeps([]), snapshot: () => Promise.reject(new Error('boom')) });
  assert.deepEqual(failing.errors, ['boom']);
  assert.equal(requireSession(db, dev.id).state, 'running');
});

test('startMonitor does nothing until active, and only one owner holds the lease', async (t) => {
  const { db } = setup(t);
  let active = false;
  let snapshots = 0;
  const deps: MonitorDeps = { ...fakeDeps([base]), snapshot: () => ((snapshots += 1), Promise.resolve(base)), active: () => active };
  const monitor = startMonitor(db, deps, 60_000);
  t.after(() => monitor.stop());
  assert.equal(await monitor.tick(), null);
  assert.equal(snapshots, 0);
  active = true;
  assert.notEqual(await monitor.tick(), null);
  assert.equal(snapshots, 1);
  const other = startMonitor(db, { ...deps }, 60_000);
  t.after(() => other.stop());
  assert.equal(await other.tick(), null, 'second front-desk server is locked out by the lease');
  assert.equal(acquireLease(db, 'someone', new Date(Date.now() + 10 * 60_000), 1000), true, 'an expired lease can be taken over');
});

test('limits default to none and round-trip normalised', (t) => {
  const { db, project } = setup(t);
  assert.deepEqual(getLimits(db, project.id), { project_id: project.id, max_processes_per_session: null, session_binary_caps: {}, machine_binary_caps: {} });
  setLimits(db, project.id, { maxProcessesPerSession: 40, sessionBinaryCaps: { ' Godot.exe ': 2 } });
  const updated = setLimits(db, project.id, { machineBinaryCaps: { 'godot.exe': 6 } });
  assert.deepEqual(updated, { project_id: project.id, max_processes_per_session: 40, session_binary_caps: { 'godot.exe': 2 }, machine_binary_caps: { 'godot.exe': 6 } });
  assert.throws(() => setLimits(db, project.id, { sessionBinaryCaps: { 'x.exe': -1 } }), /whole number/);
});
