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
  assert.deepEqual(tables, ['claims', 'goals', 'items', 'projects', 'sessions', 'spend', 'workstreams']);
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
