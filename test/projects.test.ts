import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_APPROVAL_RULES,
  DEFAULT_IDLE_STOP_MINUTES,
  addProject,
  addWorkstream,
  getProject,
  listProjects,
  listWorkstreams,
} from '../src/roster/projects.ts';
import { tempRoster } from './helpers.ts';

test('a new project gets the spec defaults and a main workstream', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha' });
  assert.equal(project.name, 'alpha');
  assert.equal(project.folder, 'C:\\work\\alpha');
  assert.equal(project.permission_mode, 'dangerously-skip-permissions');
  assert.equal(
    project.approval_rules,
    "User signs off on the high-level plan and the high-level testing approach: unit tests, end-to-end tests, and the architect's own browser click-through of every user-facing change to judge UI design and flow",
  );
  assert.equal(project.approval_rules, DEFAULT_APPROVAL_RULES);
  assert.equal(project.idle_stop_minutes, DEFAULT_IDLE_STOP_MINUTES);
  assert.equal(project.daily_budget_usd, null);
  assert.deepEqual(listWorkstreams(db, 'alpha').map((w) => [w.name, w.branch]), [['main', 'main']]);
});

test('settings and extra workstreams are stored; main may use another branch', (t) => {
  const db = tempRoster(t);
  addProject(db, {
    name: 'beta',
    folder: 'C:\\work\\beta',
    permissionMode: 'default',
    approvalRules: 'Sign off on everything',
    idleStopMinutes: 30,
    dailyBudgetUsd: 25,
    workstreams: [{ name: 'main', branch: 'master' }, { name: 'ui', branch: 'feature/ui' }],
  });
  const project = getProject(db, 'beta');
  assert.equal(project?.permission_mode, 'default');
  assert.equal(project?.approval_rules, 'Sign off on everything');
  assert.equal(project?.idle_stop_minutes, 30);
  assert.equal(project?.daily_budget_usd, 25);
  assert.deepEqual(listWorkstreams(db, 'beta').map((w) => [w.name, w.branch]), [['main', 'master'], ['ui', 'feature/ui']]);
});

test('project names are unique', (t) => {
  const db = tempRoster(t);
  addProject(db, { name: 'alpha', folder: 'C:\\a' });
  assert.throws(() => addProject(db, { name: 'alpha', folder: 'C:\\b' }), /Project "alpha" already exists/);
  assert.equal(listProjects(db).length, 1);
});

test('workstreams can be added later, once per name', (t) => {
  const db = tempRoster(t);
  addProject(db, { name: 'alpha', folder: 'C:\\a' });
  assert.equal(addWorkstream(db, 'alpha', { name: 'api', branch: 'feature/api' }).branch, 'feature/api');
  assert.throws(() => addWorkstream(db, 'alpha', { name: 'api', branch: 'x' }), /Workstream "api" already exists in alpha/);
  assert.throws(() => addWorkstream(db, 'nope', { name: 'api', branch: 'x' }), /Unknown project "nope"/);
});
