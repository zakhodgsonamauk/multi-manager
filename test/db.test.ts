import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openRoster, resolveDbPath, SCHEMA } from '../src/roster/db.ts';
import { tempDir, tempRoster } from './helpers.ts';

const firstValue = (row: object | undefined): unknown => Object.values(row ?? {})[0];

test('resolveDbPath honours MM_ROSTER_DB', () => {
  assert.equal(resolveDbPath({ MM_ROSTER_DB: 'D:\\tmp\\roster.db' }), 'D:\\tmp\\roster.db');
});

test('resolveDbPath defaults to ~/.claude/multi-manager/roster.db', () => {
  const expected = join(homedir(), '.claude', 'multi-manager', 'roster.db');
  assert.equal(resolveDbPath({}), expected);
  assert.equal(resolveDbPath({ MM_ROSTER_DB: '' }), expected);
});

test('openRoster creates the folder and turns on WAL, busy timeout and foreign keys', (t) => {
  const path = join(tempDir(t), 'nested', 'deeper', 'roster.db');
  const db = openRoster(path);
  try {
    assert.ok(existsSync(path));
    assert.equal(firstValue(db.prepare('PRAGMA journal_mode').get()), 'wal');
    assert.equal(firstValue(db.prepare('PRAGMA busy_timeout').get()), 5000);
    assert.equal(firstValue(db.prepare('PRAGMA foreign_keys').get()), 1);
  } finally {
    db.close();
  }
});

test('the schema has every roster table and a second open is harmless', (t) => {
  const db = tempRoster(t);
  openRoster().close();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ['claims', 'goals', 'items', 'model_ledger', 'projects', 'sessions', 'spend', 'workstreams']);
});

test('an old roster without sessions.wrapper_pid gains it on open, once', (t) => {
  const path = join(tempDir(t), 'roster.db');
  const old = new DatabaseSync(path);
  old.exec(SCHEMA.replace('  wrapper_pid INTEGER,\n', ''));
  old.exec("INSERT INTO sessions (role, state, created_at) VALUES ('architect', 'running', 'x')");
  const columns = (db: DatabaseSync) => db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name);
  assert.ok(!columns(old).includes('wrapper_pid'));
  old.close();
  const db = openRoster(path);
  try {
    assert.ok(columns(db).includes('wrapper_pid'));
    assert.equal(firstValue(db.prepare('SELECT wrapper_pid FROM sessions').get()), null);
    migrate(db);
    assert.equal(columns(db).filter((c) => c === 'wrapper_pid').length, 1);
  } finally {
    db.close();
  }
});

const OLD_ROLE_CHECK = "CHECK (role IN ('front-desk', 'architect', 'developer'))";
const NEW_ROLE_CHECK = "CHECK (role IN ('front-desk', 'architect', 'project-manager', 'developer'))";

/** A roster file as it was before the project-manager role: the old role CHECK, three sessions of each old role. */
function oldRoster(t: Parameters<typeof tempDir>[0]): string {
  const path = join(tempDir(t), 'roster.db');
  assert.ok(SCHEMA.includes(NEW_ROLE_CHECK), 'the current schema allows project-manager');
  const old = new DatabaseSync(path);
  old.exec(SCHEMA.replace(NEW_ROLE_CHECK, OLD_ROLE_CHECK).replace(/CREATE UNIQUE INDEX IF NOT EXISTS one_running_project_manager_per_project[^;]*;/, ''));
  old.exec("INSERT INTO projects (id, name, folder, permission_mode, approval_rules, idle_stop_minutes, created_at) VALUES (1, 'alpha', 'C:/a', 'x', 'x', 5, 'x')");
  old.exec("INSERT INTO workstreams (id, project_id, name, branch) VALUES (1, 1, 'main', 'main'), (2, 1, 'pm', 'main')");
  old.exec(`INSERT INTO sessions (id, role, parent_id, project_id, workstream_id, name, state, created_at) VALUES
    (1, 'front-desk', NULL, NULL, NULL, 'desk', 'running', 'x'),
    (2, 'architect', 1, 1, 1, 'arch', 'running', 'x'),
    (3, 'developer', 2, 1, 1, 'dev', 'running', 'x')`);
  old.exec("INSERT INTO items (id, kind, body, state, addressed_to, raised_by, created_at, updated_at) VALUES (1, 'info', 'hi', 'open', 1, 3, 'x', 'x')");
  assert.ok(String(old.prepare("SELECT sql FROM sqlite_master WHERE name = 'sessions'").get()?.sql).includes(OLD_ROLE_CHECK));
  old.close();
  return path;
}

test('an old roster with the old role CHECK is rebuilt: rows and ids kept, project-manager allowed, indexes enforced', (t) => {
  const db = openRoster(oldRoster(t));
  try {
    assert.deepEqual(db.prepare('SELECT id, role, parent_id, name FROM sessions ORDER BY id').all().map((r) => ({ ...r })), [
      { id: 1, role: 'front-desk', parent_id: null, name: 'desk' },
      { id: 2, role: 'architect', parent_id: 1, name: 'arch' },
      { id: 3, role: 'developer', parent_id: 2, name: 'dev' },
    ]);
    assert.equal(firstValue(db.prepare('SELECT COUNT(*) FROM items').get()), 1, 'items that point at sessions survive');
    const insert = (id: number, role: string, workstream: number, state = 'running') =>
      db.prepare("INSERT INTO sessions (id, role, project_id, workstream_id, state, created_at) VALUES (?, ?, 1, ?, ?, 'x')").run(id, role, workstream, state);
    insert(10, 'project-manager', 2);
    assert.throws(() => insert(11, 'project-manager', 2), /UNIQUE/, 'second running project manager for the project refused');
    insert(12, 'project-manager', 2, 'stopped');
    assert.throws(() => insert(13, 'architect', 1), /UNIQUE/, 'running-architect index still enforced');
    assert.throws(() => insert(14, 'janitor', 1), /CHECK/);
    assert.equal(firstValue(db.prepare('PRAGMA foreign_keys').get()), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('migrating the role CHECK twice is a no-op', (t) => {
  const path = oldRoster(t);
  const first = openRoster(path);
  const sqlAfterFirst = first.prepare("SELECT sql FROM sqlite_master WHERE name = 'sessions'").get()?.sql;
  migrate(first);
  assert.equal(first.prepare("SELECT sql FROM sqlite_master WHERE name = 'sessions'").get()?.sql, sqlAfterFirst);
  assert.equal(firstValue(first.prepare('SELECT COUNT(*) FROM sessions').get()), 3);
  first.close();
  const second = openRoster(path);
  try {
    assert.equal(firstValue(second.prepare('SELECT COUNT(*) FROM sessions').get()), 3);
    assert.equal(firstValue(second.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 'one_running_project_manager_per_project'").get()), 1);
  } finally {
    second.close();
  }
});

test('an unrelated dangling reference elsewhere does not stop the role migration', (t) => {
  const path = oldRoster(t);
  const old = new DatabaseSync(path);
  old.exec('PRAGMA foreign_keys = OFF');
  old.exec("INSERT INTO goals (workstream_id, text, state, created_at, updated_at) VALUES (999, 'orphan', 'new', 'x', 'x')");
  old.close();
  const db = openRoster(path);
  try {
    assert.equal(firstValue(db.prepare('SELECT COUNT(*) FROM sessions').get()), 3);
    assert.ok(String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sessions'").get()?.sql).includes("'project-manager'"));
  } finally {
    db.close();
  }
});

test('a stray column in an old sessions table does not stop the migration; known columns keep their values', (t) => {
  const path = oldRoster(t);
  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE sessions ADD COLUMN stray TEXT');
  old.exec("UPDATE sessions SET stray = 'x', name = 'kept-' || id");
  old.close();
  const db = openRoster(path);
  try {
    assert.deepEqual(db.prepare('SELECT id, name FROM sessions ORDER BY id').all().map((r) => ({ ...r })), [
      { id: 1, name: 'kept-1' },
      { id: 2, name: 'kept-2' },
      { id: 3, name: 'kept-3' },
    ]);
    assert.ok(!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'stray'));
  } finally {
    db.close();
  }
});
