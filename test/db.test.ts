import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openRoster, resolveDbPath } from '../src/roster/db.ts';
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
