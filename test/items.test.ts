import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createGoal } from '../src/roster/goals.ts';
import {
  answerItem,
  answerReply,
  closeItem,
  formatItem,
  listItems,
  markSeen,
  openItemsFor,
  raiseItem,
  requireItem,
  rerouteItems,
  unseenItemsFor,
} from '../src/roster/items.ts';
import { addProject, addWorkstream, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, setSessionState, startFrontDesk } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const goal = createGoal(db, { workstreamId: main.id, text: 'Login page' });
  return { db, desk, arch, goal };
}

test("an item goes to the raiser's parent, or to the front desk", (t) => {
  const { db, desk, arch, goal } = setup(t);
  const signoff = raiseItem(db, { kind: 'signoff', body: 'Plan: …', goalId: goal.id, raisedBy: arch.id });
  assert.equal(signoff.addressed_to, desk.id);
  assert.equal(signoff.state, 'open');
  assert.equal(signoff.seen, 0);
  const system = raiseItem(db, { kind: 'info', body: 'no raiser' });
  assert.equal(system.addressed_to, desk.id);
});

test("answering stores the user's words verbatim and hands the item back unseen", (t) => {
  const { db, desk, arch, goal } = setup(t);
  const item = raiseItem(db, { kind: 'signoff', body: 'Plan and testing approach', goalId: goal.id, raisedBy: arch.id });
  markSeen(db, [item.id]);
  const words = '  Approved — go ahead; keep it to one file.\n"Use Playwright" for the click-through 🚀  ';
  const answered = answerItem(db, item.id, words, new Date('2026-10-21T12:00:00.000Z'));
  assert.equal(answered.answer, words);
  assert.equal(answered.state, 'answered');
  assert.equal(answered.addressed_to, arch.id);
  assert.equal(answered.seen, 0);
  assert.equal(answered.answered_at, '2026-10-21T12:00:00.000Z');
  assert.notEqual(answered.addressed_to, desk.id);
  assert.throws(() => answerItem(db, item.id, 'again'), /Item #\d+ is answered, not open/);
});

test('unseen items are listed until marked seen; closed items drop out', (t) => {
  const { db, desk, arch, goal } = setup(t);
  const a = raiseItem(db, { kind: 'question', body: 'A?', goalId: goal.id, raisedBy: arch.id });
  const b = raiseItem(db, { kind: 'blocked', body: 'B', raisedBy: arch.id });
  assert.deepEqual(unseenItemsFor(db, desk.id).map((i) => i.id), [a.id, b.id]);
  markSeen(db, [a.id]);
  assert.deepEqual(unseenItemsFor(db, desk.id).map((i) => i.id), [b.id]);
  assert.deepEqual(openItemsFor(db, desk.id).map((i) => i.id), [a.id, b.id]);
  closeItem(db, b.id);
  assert.deepEqual(openItemsFor(db, desk.id).map((i) => i.id), [a.id]);
  assert.deepEqual(listItems(db, { goalId: goal.id }).map((i) => i.id), [a.id]);
  assert.deepEqual(listItems(db, { states: ['closed'] }).map((i) => i.id), [b.id]);
});

test('formatItem shows id, kind, state, goal, body and the verbatim answer', (t) => {
  const { db, arch, goal } = setup(t);
  const item = raiseItem(db, { kind: 'signoff', body: 'Plan v1', goalId: goal.id, raisedBy: arch.id });
  const text = formatItem(answerItem(db, item.id, 'Yes, but no new deps.'));
  assert.equal(text, `#${item.id} [signoff, answered, goal #${goal.id}] Plan v1\n  Answer (verbatim): Yes, but no new deps.`);
});

test('answering an item whose raiser is stopped keeps the words and nudges nobody', (t) => {
  const { db, arch, goal } = setup(t);
  const item = raiseItem(db, { kind: 'done', body: 'Done: login page', goalId: goal.id, raisedBy: arch.id });
  setSessionState(db, arch.id, 'stopped');
  const words = '  Thanks — merge it.\n';
  const answered = answerItem(db, item.id, words);
  assert.equal(answered.state, 'answered');
  assert.equal(answered.answer, words);
  assert.deepEqual(answerReply(db, answered), {
    nudge: null,
    note: 'Answer saved. mm-alpha-main is stopped, so nobody was told.',
  });
});

test('answering an item whose raiser is running nudges it as before', (t) => {
  const { db, arch, goal } = setup(t);
  const item = raiseItem(db, { kind: 'question', body: 'A or B?', goalId: goal.id, raisedBy: arch.id });
  const answered = answerItem(db, item.id, 'A');
  assert.deepEqual(answerReply(db, answered), { nudge: { to: 'mm-alpha-main', message: `check roster item #${item.id}` } });
});

function setupPm(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const pmStream = addWorkstream(db, 'alpha', { name: 'pm', branch: 'main' });
  const pm = registerSession(db, { role: 'project-manager', parentId: desk.id, projectId: project.id, workstreamId: pmStream.id, name: 'mm-alpha-pm' });
  const arch = registerSession(db, { role: 'architect', parentId: pm.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const dev = registerSession(db, { role: 'developer', parentId: arch.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-dev' });
  return { db, desk, pm, arch, dev };
}

test('an architect under a running project manager: signoff and question go to the front desk, watched by the manager', (t) => {
  const { db, desk, pm, arch } = setupPm(t);
  for (const kind of ['signoff', 'question'] as const) {
    const item = raiseItem(db, { kind, body: 'x', raisedBy: arch.id });
    assert.equal(item.addressed_to, desk.id);
    assert.equal(item.watched_by, pm.id);
  }
});

test('done, blocked and info from such an architect go to the project manager, unwatched', (t) => {
  const { db, pm, arch } = setupPm(t);
  for (const kind of ['done', 'blocked', 'info'] as const) {
    const item = raiseItem(db, { kind, body: 'x', raisedBy: arch.id });
    assert.equal(item.addressed_to, pm.id);
    assert.equal(item.watched_by, null);
  }
});

test('architect under the front desk, stopped manager, developer, explicit addressee: routing as before', (t) => {
  const { db, desk, pm, arch, dev } = setupPm(t);
  const direct = registerSession(db, { role: 'architect', parentId: desk.id, projectId: arch.project_id, workstreamId: arch.workstream_id, name: 'direct', state: 'stopped' });
  const underDesk = raiseItem(db, { kind: 'signoff', body: 'x', raisedBy: direct.id });
  assert.equal(underDesk.addressed_to, desk.id);
  assert.equal(underDesk.watched_by, null);
  const fromDev = raiseItem(db, { kind: 'signoff', body: 'x', raisedBy: dev.id });
  assert.equal(fromDev.addressed_to, arch.id);
  assert.equal(fromDev.watched_by, null);
  const explicit = raiseItem(db, { kind: 'signoff', body: 'x', raisedBy: arch.id, addressedTo: pm.id });
  assert.equal(explicit.addressed_to, pm.id);
  assert.equal(explicit.watched_by, null);
  setSessionState(db, pm.id, 'stopped');
  const stopped = raiseItem(db, { kind: 'signoff', body: 'x', raisedBy: arch.id });
  assert.equal(stopped.addressed_to, desk.id);
  assert.equal(stopped.watched_by, null);
});

test('the project manager sees watched items, with the answer, but cannot answer them', (t) => {
  const { db, pm, arch } = setupPm(t);
  const item = raiseItem(db, { kind: 'signoff', body: 'Plan', raisedBy: arch.id });
  const before = listItems(db, { involving: pm.id, states: ['open', 'answered'] });
  assert.deepEqual(before.map((i) => i.id), [item.id]);
  answerItem(db, item.id, ' go ');
  const after = listItems(db, { involving: pm.id, states: ['open', 'answered'] });
  assert.equal(after[0].state, 'answered');
  assert.equal(after[0].answer, ' go ');
  assert.equal(after[0].watched_by, pm.id);
  assert.equal(after[0].addressed_to, arch.id);
});

test('rerouteItems: open items naming the old parent move by the new parent; others are untouched and not returned', (t) => {
  const { db, desk, arch } = setup(t);
  const project = arch.project_id as number;
  const ws = (name: string) => { addWorkstream(db, 'alpha', { name, branch: 'main' }); return requireWorkstream(db, project, name).id; };
  const oldPm = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project, workstreamId: ws('w1'), name: 'old-pm' });
  const pm = registerSession(db, { role: 'project-manager', parentId: desk.id, projectId: project, workstreamId: ws('w2'), name: 'new-pm' });
  const child = registerSession(db, { role: 'architect', parentId: oldPm.id, projectId: project, workstreamId: ws('w3'), name: 'child' });
  const done = raiseItem(db, { kind: 'done', body: 'built', raisedBy: child.id });
  const signoff = raiseItem(db, { kind: 'signoff', body: 'ok?', raisedBy: child.id });
  const elsewhere = raiseItem(db, { kind: 'done', body: 'to the desk', raisedBy: child.id, addressedTo: desk.id });
  markSeen(db, [done.id, signoff.id, elsewhere.id]);
  db.prepare('UPDATE sessions SET parent_id = ? WHERE id = ?').run(pm.id, child.id);
  const changed = rerouteItems(db, oldPm.id, [child.id]);
  assert.deepEqual(changed, [done.id, signoff.id]);
  assert.equal(requireItem(db, done.id).addressed_to, pm.id);
  assert.equal(requireItem(db, done.id).seen, 0);
  assert.equal(requireItem(db, signoff.id).addressed_to, desk.id);
  assert.equal(requireItem(db, signoff.id).watched_by, pm.id);
  assert.equal(requireItem(db, signoff.id).seen, 0);
  assert.equal(requireItem(db, elsewhere.id).addressed_to, desk.id);
  assert.equal(requireItem(db, elsewhere.id).seen, 1);
});
