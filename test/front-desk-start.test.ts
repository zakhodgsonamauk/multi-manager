import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createGoal } from '../src/roster/goals.ts';
import { raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { PROJECT_ITEM_TEXT_MAX, STATUS_TEXT_MAX, statusSummary } from '../src/roster/status.ts';
import { frontDeskStartText } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

const pluginRoot = join(import.meta.dirname, '..');

function bigRoster(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const names = ['alpha', 'beta', 'gamma'];
  const seats = names.map((name) => {
    const p = addProject(db, { name, folder: `C:\\${name}` });
    const main = requireWorkstream(db, p.id, 'main');
    const arch = registerSession(db, { role: 'architect', projectId: p.id, workstreamId: main.id, name: `mm-${name}-main` });
    return { main, arch };
  });
  // 20 active goals and 20 open architect items of 5,000 characters, spread over 3 projects.
  for (let i = 0; i < 20; i++) {
    const seat = seats[i % 3];
    const goal = createGoal(db, { workstreamId: seat.main.id, text: 'g'.repeat(5000) });
    raiseItem(db, { kind: 'question', body: 'b'.repeat(5000), goalId: goal.id, addressedTo: seat.arch.id });
  }
  for (let i = 0; i < 5; i++) raiseItem(db, { kind: 'signoff', body: 'w'.repeat(5000), addressedTo: desk.id });
  return { db, desk };
}

test('the whole start_front_desk text stays under 25,000 characters with large data', (t) => {
  const { db, desk } = bigRoster(t);
  const text = frontDeskStartText(db, pluginRoot, desk);
  console.log(`start_front_desk text size, 3 projects, 20 goals + 20 items + 5 waiting x 5000 chars: ${text.length}`);
  assert.equal(text.length < 25_000, true);
});

test('the status part of the start text is compact JSON that parses', (t) => {
  const { db, desk } = bigRoster(t);
  const text = frontDeskStartText(db, pluginRoot, desk);
  const marker = '## Status (waiting items first)\n\n';
  const json = text.slice(text.indexOf(marker) + marker.length);
  assert.equal(json.includes('\n'), false);
  const parsed = JSON.parse(json) as ReturnType<typeof statusSummary>;
  assert.equal(parsed.waiting_for_user.length, 5);
  assert.equal(parsed.projects.length, 3);
  console.log(`status JSON size (compact): ${json.length}`);
});

test('a waiting item is listed once, under waiting_for_user; architect items stay under their project', (t) => {
  const { db } = bigRoster(t);
  const status = statusSummary(db);
  const waitingIds = new Set(status.waiting_for_user.map((i) => i.id));
  assert.equal(waitingIds.size, 5);
  const projectItems = status.projects.flatMap((p) => p.open_items);
  assert.equal(projectItems.some((i) => waitingIds.has(i.id)), false);
  assert.equal(projectItems.length, 20);
  // Project items are cut at 120 characters, waiting items at 250.
  assert.equal(PROJECT_ITEM_TEXT_MAX, 120);
  assert.equal(projectItems.every((i) => i.body.length <= PROJECT_ITEM_TEXT_MAX && i.body_cut === true), true);
  assert.equal(status.waiting_for_user.every((i) => i.body.length <= STATUS_TEXT_MAX && i.body.length > PROJECT_ITEM_TEXT_MAX), true);
});
