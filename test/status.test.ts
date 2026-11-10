import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGoal, requireGoal, updateGoal } from '../src/roster/goals.ts';
import { closeItem, listItems, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { checkIn, registerSession, setSessionModel, setSessionState, startFrontDesk } from '../src/roster/sessions.ts';
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
  // The signoff waits for the user: listed once, under waiting_for_user, not again under its project.
  assert.deepEqual(a.open_items.map((i) => i.id), []);
  assert.equal(status.waiting_for_user[0].seen, false);
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
  raiseItem(db, { kind: 'blocked', body: 'Finished', raisedBy: ui.id });
  setSessionState(db, ui.id, 'stopped');
  const waiting = statusSummary(db).waiting_for_user;
  assert.deepEqual(waiting.map((i) => [i.raised_by, i.raised_by_running]), [['mm-alpha-main', true], ['mm-alpha-ui', false]]);
});

test('status cuts long goal texts and item bodies and answers, and flags only what it cut', (t) => {
  const db = tempRoster(t);
  startFrontDesk(db);
  const p = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, p.id, 'main');
  const longGoal = createGoal(db, { workstreamId: main.id, text: 'g'.repeat(5000) });
  const shortGoal = createGoal(db, { workstreamId: main.id, text: 'short goal' });
  const longItem = raiseItem(db, { kind: 'question', body: 'b'.repeat(5000), goalId: longGoal.id });
  const shortItem = raiseItem(db, { kind: 'question', body: 'short body', goalId: longGoal.id });
  db.prepare('UPDATE items SET answer = ? WHERE id = ?').run('a'.repeat(5000), longItem.id);

  const a = statusSummary(db).projects[0];
  const goal = a.active_goals.find((g) => g.id === longGoal.id);
  assert.ok(goal);
  assert.equal(goal.text.length <= 300, true);
  assert.equal(goal.text.endsWith(` … (full text: get_goal ${longGoal.id})`), true);
  assert.equal(goal.text_cut, true);
  const short = a.active_goals.find((g) => g.id === shortGoal.id);
  assert.equal(short?.text, 'short goal');
  assert.equal('text_cut' in (short ?? {}), false);

  const item = statusSummary(db).waiting_for_user.find((i) => i.id === longItem.id);
  assert.ok(item);
  assert.equal(item.body.length <= 300, true);
  assert.equal(item.body.endsWith(' … (full text: list_items)'), true);
  assert.equal(item.body_cut, true);
  assert.equal(item.answer?.length !== undefined && item.answer.length <= 300, true);
  assert.equal(item.answer?.endsWith(' … (full text: list_items)'), true);
  assert.equal(item.answer_cut, true);
  const plain = statusSummary(db).waiting_for_user.find((i) => i.id === shortItem.id);
  assert.equal(plain?.body, 'short body');
  assert.equal('body_cut' in (plain ?? {}), false);
  assert.equal('answer_cut' in (plain ?? {}), false);
  // The same cut applies to the waiting list.
  const waiting = statusSummary(db).waiting_for_user.find((i) => i.id === longItem.id);
  assert.equal(waiting?.body_cut, true);
});

test('status with 20 big goals and 20 big items across two projects stays small, and the full texts remain elsewhere', (t) => {
  const db = tempRoster(t);
  startFrontDesk(db);
  for (const name of ['alpha', 'beta']) {
    const p = addProject(db, { name, folder: `C:\${name}` });
    const main = requireWorkstream(db, p.id, 'main');
    // Items for the architect (from its developers) appear once, under the project. Items for the front desk
    // appear once, under waiting_for_user, and not in the project's open_items.
    const arch = registerSession(db, { role: 'architect', projectId: p.id, workstreamId: main.id, name: `mm-${name}-main` });
    for (let i = 0; i < 10; i++) {
      const goal = createGoal(db, { workstreamId: main.id, text: 'g'.repeat(5000) });
      raiseItem(db, { kind: 'question', body: 'b'.repeat(5000), goalId: goal.id, addressedTo: arch.id });
    }
  }
  const size = JSON.stringify(statusSummary(db), null, 2).length;
  console.log(`status size, 20 goals x 5000 chars + 20 items x 5000 chars: ${size}`);
  assert.equal(size < 25_000, true);
  // list_items and get_goal read the database directly: full text.
  assert.equal(listItems(db, {}).every((i) => i.body.length === 5000), true);
  assert.equal(requireGoal(db, 1).text.length, 5000);
});

test('status names the project manager, hides the pm workstream, and says who manages each architect', (t) => {
  const db = tempRoster(t);
  const now = new Date('2026-10-21T15:00:00.000Z');
  const desk = startFrontDesk(db, 'mm-front-desk', now);
  const p = addProject(db, {
    name: 'alpha',
    folder: 'C:/a',
    workstreams: [{ name: 'pm', branch: 'main' }, { name: 'ui', branch: 'ui' }, { name: 'api', branch: 'api' }],
  });
  const pmId = requireWorkstream(db, p.id, 'pm').id;
  const pm = registerSession(db, { role: 'project-manager', parentId: desk.id, projectId: p.id, workstreamId: pmId, name: 'mm-alpha-pm' }, now);
  setSessionModel(db, pm.id, 'opus');
  const ui = registerSession(db, { role: 'architect', parentId: pm.id, projectId: p.id, workstreamId: requireWorkstream(db, p.id, 'ui').id, name: 'mm-alpha-ui' }, now);
  const api = registerSession(db, { role: 'architect', parentId: pm.id, projectId: p.id, workstreamId: requireWorkstream(db, p.id, 'api').id, name: 'mm-alpha-api' }, now);
  const main = registerSession(db, { role: 'architect', parentId: desk.id, projectId: p.id, workstreamId: requireWorkstream(db, p.id, 'main').id, name: 'mm-alpha-main' }, now);
  createGoal(db, { workstreamId: pmId, text: 'Run the project' });

  const a = statusSummary(db, now).projects[0];
  assert.deepEqual(a.project_manager, { session_id: pm.id, name: 'mm-alpha-pm', state: 'running', model: 'opus', last_checkin_at: now.toISOString() });
  assert.deepEqual(a.workstreams.map((w) => w.name), ['main', 'ui', 'api']);
  const managed = Object.fromEntries(a.workstreams.map((w) => [w.name, w.architect?.managed_by]));
  assert.deepEqual(managed, { main: null, ui: pm.id, api: pm.id });
  assert.equal(ui.id > 0 && api.id > 0 && main.id > 0, true);
  // The pm workstream's goals still show, under the project manager.
  assert.deepEqual(a.active_goals.map((g) => g.workstream), ['pm']);
});

test('a project with no project manager keeps today\'s shape', (t) => {
  const db = tempRoster(t);
  const now = new Date('2026-10-21T15:00:00.000Z');
  const desk = startFrontDesk(db, 'mm-front-desk', now);
  const p = addProject(db, { name: 'alpha', folder: 'C:/a', workstreams: [{ name: 'pm', branch: 'main' }] });
  registerSession(db, { role: 'architect', parentId: desk.id, projectId: p.id, workstreamId: requireWorkstream(db, p.id, 'main').id, name: 'mm-alpha-main' }, now);
  const a = statusSummary(db, now).projects[0];
  assert.equal(a.project_manager, null);
  // No project manager runs: pm is an ordinary workstream, and the architect's managed_by is null.
  assert.deepEqual(a.workstreams.map((w) => w.name), ['main', 'pm']);
  assert.equal(a.workstreams[0].architect?.managed_by, null);
  assert.deepEqual(Object.keys(a.workstreams[0].architect ?? {}).sort(), ['last_checkin_at', 'managed_by', 'minutes_since_checkin', 'name', 'pid', 'session_id', 'stale']);
});

test('status splits what needs action (oldest first) from information (newest first, cut to 120); waiting_for_user is needs_action', (t) => {
  const db = tempRoster(t);
  const now = new Date('2026-10-21T15:00:00.000Z');
  const desk = startFrontDesk(db, 'mm-front-desk', now);
  const q = raiseItem(db, { kind: 'question', body: 'second', addressedTo: desk.id }, minutesBefore(now, 10));
  const s = raiseItem(db, { kind: 'signoff', body: 'first', addressedTo: desk.id }, minutesBefore(now, 30));
  const b = raiseItem(db, { kind: 'blocked', body: 'third', addressedTo: desk.id }, minutesBefore(now, 5));
  const d1 = raiseItem(db, { kind: 'done', body: 'old note', addressedTo: desk.id }, minutesBefore(now, 20));
  const d2 = raiseItem(db, { kind: 'info', body: 'n'.repeat(500), addressedTo: desk.id }, minutesBefore(now, 2));
  const status = statusSummary(db, now);
  assert.deepEqual(status.needs_action.map((i) => i.id), [s.id, q.id, b.id]);
  assert.deepEqual(status.for_information.map((i) => i.id), [d2.id, d1.id]);
  assert.equal(status.for_information[0].body.length <= 120, true);
  assert.equal(status.for_information[0].body_cut, true);
  assert.deepEqual(status.waiting_for_user, status.needs_action);
});
