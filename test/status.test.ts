import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGoal, updateGoal } from '../src/roster/goals.ts';
import { closeItem, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { checkIn, registerSession, setSessionState, startFrontDesk } from '../src/roster/sessions.ts';
import { reportSpend } from '../src/roster/spend.ts';
import { statusSummary } from '../src/roster/status.ts';
import { minutesBefore, tempRoster } from './helpers.ts';

test('status lists waiting items first, then each project in full', (t) => {
  const db = tempRoster(t);
  const now = new Date('2026-10-21T15:00:00.000Z');
  const desk = startFrontDesk(db, 'mm-front-desk', now);
  const alpha = addProject(db, { name: 'alpha', folder: 'C:\\a', dailyBudgetUsd: 20, workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  addProject(db, { name: 'beta', folder: 'C:\\b' });
  const main = requireWorkstream(db, alpha.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: alpha.id, workstreamId: main.id, name: 'mm-alpha-main' }, now);
  checkIn(db, arch.id, minutesBefore(now, 45));
  const active = createGoal(db, { workstreamId: main.id, text: 'Login page', budgetUsd: 10 });
  const finished = createGoal(db, { workstreamId: main.id, text: 'Old' });
  updateGoal(db, finished.id, { state: 'done' });
  reportSpend(db, { usd: 2.5, sessionId: arch.id, goalId: active.id }, minutesBefore(now, 10));
  const signoff = raiseItem(db, { kind: 'signoff', body: 'Plan + tests', goalId: active.id, raisedBy: arch.id }, minutesBefore(now, 5));
  const note = raiseItem(db, { kind: 'info', body: 'FYI', raisedBy: arch.id });
  closeItem(db, note.id);

  const status = statusSummary(db, now);
  assert.equal(status.generated_at, now.toISOString());
  assert.deepEqual(status.waiting_for_user.map((i) => [i.id, i.kind, i.raised_by]), [[signoff.id, 'signoff', 'mm-alpha-main']]);
  assert.deepEqual(status.projects.map((p) => p.name), ['alpha', 'beta']);
  const a = status.projects[0];
  assert.equal(a.spend_today_usd, 2.5);
  assert.equal(a.daily_budget_usd, 20);
  assert.deepEqual(a.workstreams.map((w) => [w.name, w.branch, w.architect?.name ?? null]), [['main', 'main', 'mm-alpha-main'], ['ui', 'feature/ui', null]]);
  assert.equal(a.workstreams[0].architect?.minutes_since_checkin, 45);
  assert.equal(a.workstreams[0].architect?.stale, true);
  assert.deepEqual(a.active_goals.map((g) => [g.id, g.state, g.spent_usd, g.workstream]), [[active.id, 'new', 2.5, 'main']]);
  assert.deepEqual(a.open_items.map((i) => i.id), [signoff.id]);
  assert.equal(a.open_items[0].seen, false);
  assert.deepEqual(status.projects[1].active_goals, []);
});

test('a recently checked-in architect is not stale', (t) => {
  const db = tempRoster(t);
  const now = new Date('2026-10-21T15:00:00.000Z');
  const p = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, p.id, 'main');
  const arch = registerSession(db, { role: 'architect', projectId: p.id, workstreamId: main.id, name: 'mm-alpha-main' });
  checkIn(db, arch.id, minutesBefore(now, 5));
  assert.equal(statusSummary(db, now).projects[0].workstreams[0].architect?.stale, false);
});

test('each waiting item says whether its raiser is still running', (t) => {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const p = addProject(db, { name: 'alpha', folder: 'C:\\a', workstreams: [{ name: 'ui', branch: 'ui' }] });
  const mainId = requireWorkstream(db, p.id, 'main').id;
  const uiId = requireWorkstream(db, p.id, 'ui').id;
  const main = registerSession(db, { role: 'architect', parentId: desk.id, projectId: p.id, workstreamId: mainId, name: 'mm-alpha-main' });
  const ui = registerSession(db, { role: 'architect', parentId: desk.id, projectId: p.id, workstreamId: uiId, name: 'mm-alpha-ui' });
  raiseItem(db, { kind: 'question', body: 'Still here?', raisedBy: main.id });
  raiseItem(db, { kind: 'done', body: 'Finished', raisedBy: ui.id });
  setSessionState(db, ui.id, 'stopped');
  const waiting = statusSummary(db).waiting_for_user;
  assert.deepEqual(waiting.map((i) => [i.raised_by, i.raised_by_running]), [['mm-alpha-main', true], ['mm-alpha-ui', false]]);
});
