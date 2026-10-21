import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeGoals, createGoal, goalWithPlace, updateGoal, type GoalState } from '../src/roster/goals.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { tempRoster } from './helpers.ts';

test('goals start new and move through their states', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const created = createGoal(db, { workstreamId: main.id, text: 'Add a login page', budgetUsd: 5 }, new Date('2026-10-21T09:00:00.000Z'));
  assert.equal(created.state, 'new');
  assert.equal(created.budget_usd, 5);
  const steps: GoalState[] = ['planning', 'awaiting-signoff', 'in-progress', 'done'];
  let minute = 1;
  for (const state of steps) {
    const at = new Date(`2026-10-21T09:0${minute}:00.000Z`);
    const updated = updateGoal(db, created.id, { state }, at);
    assert.equal(updated.state, state);
    assert.equal(updated.updated_at, at.toISOString());
    minute += 1;
  }
  assert.throws(() => updateGoal(db, created.id, { state: 'planning' }), /Goal #\d+ is done and cannot change/);
});

test('unknown states and empty text are rejected', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const goal = createGoal(db, { workstreamId: main.id, text: 'x' });
  assert.throws(() => updateGoal(db, goal.id, { state: 'paused' as GoalState }), /Unknown goal state "paused"/);
  assert.throws(() => createGoal(db, { workstreamId: main.id, text: '   ' }), /A goal needs some text/);
});

test('active goals exclude done and cancelled, and carry project and workstream names', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  const ui = requireWorkstream(db, project.id, 'ui');
  const keep = createGoal(db, { workstreamId: ui.id, text: 'keep' });
  const done = createGoal(db, { workstreamId: ui.id, text: 'done' });
  const cancelled = createGoal(db, { workstreamId: ui.id, text: 'cancelled' });
  updateGoal(db, done.id, { state: 'done' });
  updateGoal(db, cancelled.id, { state: 'cancelled' });
  assert.deepEqual(activeGoals(db, project.id).map((g) => [g.id, g.project, g.workstream]), [[keep.id, 'alpha', 'ui']]);
  assert.equal(goalWithPlace(db, done.id).project_id, project.id);
});
