import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { RunResult } from '../src/launch/runner.ts';
import { runTick, type MonitorDeps } from '../src/monitor/monitor.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { createGoal, updateGoal } from '../src/roster/goals.ts';
import { answerItem, autoClearItems, raiseItem, requireItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { minutesBefore, tempRoster } from './helpers.ts';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const H = 60;

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const live = createGoal(db, { workstreamId: main.id, text: 'Live goal' });
  const finished = createGoal(db, { workstreamId: main.id, text: 'Finished goal' });
  updateGoal(db, finished.id, { state: 'done' });
  const raise = (kind: 'info' | 'done' | 'signoff', ageMinutes: number, goalId?: number) =>
    raiseItem(db, { kind, body: `${kind} ${ageMinutes}`, addressedTo: desk.id, goalId }, minutesBefore(NOW, ageMinutes)).id;
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  return { db, desk, project, arch, live, finished, raise };
}

test('auto-clear closes old information items and keeps the rest; a second pass closes nothing', (t) => {
  const { db, project, arch, live, finished, raise } = setup(t);
  const old = raise('info', 25 * H, live.id);
  const recent = raise('info', 2 * H, live.id);
  const oldDone = raise('done', 2 * H, finished.id);
  const freshDone = raise('done', 30, finished.id);
  const decision = raise('signoff', 30 * 24 * H, live.id);
  const cancelled = createGoal(db, { workstreamId: requireWorkstream(db, project.id, 'main').id, text: 'Cancelled goal' });
  updateGoal(db, cancelled.id, { state: 'cancelled' });
  const onCancelled = raise('info', 2 * H, cancelled.id);
  const toArchitect = raiseItem(db, { kind: 'info', body: 'for the architect', addressedTo: arch.id }, minutesBefore(NOW, 25 * H)).id;
  const answered = raise('info', 30 * H);
  answerItem(db, answered, 'ok', minutesBefore(NOW, 29 * H));
  assert.equal(autoClearItems(db, NOW), 4);
  const state = (id: number) => requireItem(db, id).state;
  assert.deepEqual(
    [old, recent, oldDone, freshDone, decision, answered, onCancelled, toArchitect].map(state),
    ['closed', 'open', 'closed', 'open', 'open', 'answered', 'closed', 'closed'],
  );
  assert.equal(autoClearItems(db, NOW), 0);
});

test('the monitor pass records how many items it auto-closed', async (t) => {
  const { db, raise } = setup(t);
  raise('info', 25 * H);
  const deps: MonitorDeps = {
    snapshot: () => Promise.resolve<ProcessInfo[]>([{ pid: 1, ppid: 0, name: 'node.exe', created: 0, commandLine: null }]),
    kill: (): Promise<RunResult> => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
    selfPid: 1,
    now: () => NOW,
  };
  assert.equal((await runTick(db, deps)).autoClosed, 1);
  assert.equal((await runTick(db, deps)).autoClosed, 0);
});
