import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createGoal } from '../src/roster/goals.ts';
import { listItems } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { reportSpend, spendForGoal, spendToday } from '../src/roster/spend.ts';
import { tempRoster } from './helpers.ts';

const at = (time: string) => new Date(`2026-10-21T${time}:00.000Z`);

function setup(t: TestContext, dailyBudgetUsd: number | null) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', dailyBudgetUsd });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  return { db, desk, project, main, arch };
}

test('crossing a goal budget raises one blocked item to the front desk', (t) => {
  const { db, desk, main, arch } = setup(t, null);
  const goal = createGoal(db, { workstreamId: main.id, text: 'g', budgetUsd: 5 });
  assert.deepEqual(reportSpend(db, { usd: 3, sessionId: arch.id, goalId: goal.id }, at('09:00')).raised, []);
  const crossing = reportSpend(db, { usd: 3, sessionId: arch.id, goalId: goal.id }, at('10:00'));
  assert.equal(crossing.raised.length, 1);
  assert.equal(crossing.raised[0].kind, 'blocked');
  assert.equal(crossing.raised[0].addressed_to, desk.id);
  assert.equal(crossing.raised[0].goal_id, goal.id);
  assert.match(crossing.raised[0].body, /Goal #\d+ is over budget: \$6\.00 spent of \$5\.00/);
  assert.deepEqual(reportSpend(db, { usd: 1, sessionId: arch.id, goalId: goal.id }, at('11:00')).raised, []);
  assert.equal(spendForGoal(db, goal.id), 7);
});

test('crossing the project daily budget raises one info item; yesterday does not count', (t) => {
  const { db, desk, project, arch } = setup(t, 10);
  reportSpend(db, { usd: 9, sessionId: arch.id }, new Date('2026-10-20T23:30:00.000Z'));
  assert.deepEqual(reportSpend(db, { usd: 6, sessionId: arch.id }, at('01:00')).raised, []);
  const crossing = reportSpend(db, { usd: 5, sessionId: arch.id }, at('02:00'));
  assert.equal(crossing.raised.length, 1);
  assert.equal(crossing.raised[0].kind, 'info');
  assert.equal(crossing.raised[0].addressed_to, desk.id);
  assert.match(crossing.raised[0].body, /Project alpha is over its daily budget: \$11\.00 spent today \(UTC\) of \$10\.00/);
  assert.equal(spendToday(db, project.id, at('03:00')), 11);
  assert.equal(listItems(db, { addressedTo: desk.id }).length, 1);
});

test('spend needs a project and a non-negative amount', (t) => {
  const { db, project } = setup(t, null);
  assert.throws(() => reportSpend(db, { usd: -1, projectId: project.id }), /non-negative/);
  assert.throws(() => reportSpend(db, { usd: 1 }), /Cannot tell which project/);
  assert.equal(reportSpend(db, { usd: 1, projectId: project.id }).project_id, project.id);
});
