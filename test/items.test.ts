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
  unseenItemsFor,
} from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
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
