import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { SCHEMA, openRoster } from '../src/roster/db.ts';
import {
  addProject,
  listProjects,
  listWorkstreams,
  requireWorkstream,
  setProjectArchived,
  setWorkstreamArchived,
} from '../src/roster/projects.ts';
import { registerSession, setSessionState, startFrontDesk } from '../src/roster/sessions.ts';
import { createGoal } from '../src/roster/goals.ts';
import { statusSummary } from '../src/roster/status.ts';
import { tempDir, tempRoster } from './helpers.ts';

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const shop = addProject(db, { name: 'shop', folder: 'C:\\shop', workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  addProject(db, { name: 'blog', folder: 'C:\\blog' });
  const main = requireWorkstream(db, shop.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: shop.id, workstreamId: main.id, name: 'mm-shop-main' });
  return { db, arch };
}

const shown = (db: DatabaseSync) =>
  statusSummary(db).projects.map((p) => [p.name, p.workstreams.map((w) => w.name)] as [string, string[]]);

test('a workstream with no running architect can be hidden from status and shown again', (t) => {
  const { db } = setup(t);
  const hidden = setWorkstreamArchived(db, 'shop', 'ui', true, new Date('2026-10-23T09:00:00.000Z'));
  assert.equal(hidden.archived_at, '2026-10-23T09:00:00.000Z');
  assert.deepEqual(shown(db), [['blog', ['main']], ['shop', ['main']]]);
  // Still listed, with the flag, so nothing is lost.
  assert.deepEqual(listWorkstreams(db, 'shop').map((w) => [w.name, w.archived_at]), [['main', null], ['ui', '2026-10-23T09:00:00.000Z']]);

  assert.equal(setWorkstreamArchived(db, 'shop', 'ui', false).archived_at, null);
  assert.deepEqual(shown(db), [['blog', ['main']], ['shop', ['main', 'ui']]]);
});

test('hiding is refused while an architect for it is running', (t) => {
  const { db, arch } = setup(t);
  assert.throws(() => setWorkstreamArchived(db, 'shop', 'main', true), /mm-shop-main is still running for shop\/main: stop it first/);
  assert.throws(() => setProjectArchived(db, 'shop', true), /mm-shop-main is still running for shop\/main: stop it first/);
  assert.deepEqual(shown(db), [['blog', ['main']], ['shop', ['main', 'ui']]]);

  setSessionState(db, arch.id, 'stopped');
  setWorkstreamArchived(db, 'shop', 'main', true);
  assert.deepEqual(shown(db), [['blog', ['main']], ['shop', ['ui']]]);
});

test('a hidden project drops out of status but stays in the project list', (t) => {
  const { db } = setup(t);
  const hidden = setProjectArchived(db, 'blog', true, new Date('2026-10-23T09:30:00.000Z'));
  assert.equal(hidden.archived_at, '2026-10-23T09:30:00.000Z');
  assert.deepEqual(shown(db), [['shop', ['main', 'ui']]]);
  assert.deepEqual(listProjects(db).map((p) => [p.name, p.archived_at]), [['blog', '2026-10-23T09:30:00.000Z'], ['shop', null]]);

  setProjectArchived(db, 'blog', false);
  assert.deepEqual(shown(db).map(([name]) => name), ['blog', 'shop']);
});

test('an old roster without archived_at columns gains them on open', (t) => {
  const path = join(tempDir(t), 'roster.db');
  const old = new DatabaseSync(path);
  old.exec(SCHEMA);
  old.exec("INSERT INTO projects (name, folder, permission_mode, approval_rules, idle_stop_minutes, created_at) VALUES ('old', 'C:\\old', 'm', 'r', 1, 'x')");
  old.exec("INSERT INTO workstreams (project_id, name, branch) VALUES (1, 'main', 'main')");
  const columns = (db: DatabaseSync, table: string) => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  assert.ok(!columns(old, 'projects').includes('archived_at'));
  assert.ok(!columns(old, 'workstreams').includes('archived_at'));
  old.close();
  const db = openRoster(path);
  try {
    assert.ok(columns(db, 'projects').includes('archived_at'));
    assert.ok(columns(db, 'workstreams').includes('archived_at'));
    assert.deepEqual(statusSummary(db).projects.map((p) => [p.name, p.workstreams.map((w) => w.name)]), [['old', ['main']]]);
  } finally {
    db.close();
  }
});

test("a hidden workstream's open goals hide with it", (t) => {
  const { db } = setup(t);
  const shop = listProjects(db).find((p) => p.name === 'shop');
  assert.ok(shop !== undefined);
  createGoal(db, { workstreamId: requireWorkstream(db, shop.id, 'ui').id, text: 'restyle the cart' });
  createGoal(db, { workstreamId: requireWorkstream(db, shop.id, 'main').id, text: 'fix checkout' });
  const goals = () => statusSummary(db).projects.find((p) => p.name === 'shop')?.active_goals.map((g) => g.text);
  assert.deepEqual(goals(), ['restyle the cart', 'fix checkout']);
  setWorkstreamArchived(db, 'shop', 'ui', true);
  assert.deepEqual(goals(), ['fix checkout']);
});
