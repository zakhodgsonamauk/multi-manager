import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRoster } from '../src/roster/db.ts';
import { addProject } from '../src/roster/projects.ts';
import { registerSession } from '../src/roster/sessions.ts';
import { listModelUsage, recordModelChange } from '../src/roster/model-ledger.ts';

let dir: string;
after(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function tempDb(): DatabaseSync {
  dir = mkdtempSync(join(tmpdir(), 'mm-ledger-'));
  return openRoster(join(dir, 'roster.db'));
}

test('a model change is recorded and listed newest-first', () => {
  const db = tempDb();
  const project = addProject(db, { name: 'alpha', folder: 'C:\\x' });
  const session = registerSession(db, { role: 'developer', projectId: project.id, name: 'mm-alpha-main-dev-x', folder: 'C:\\x' });
  recordModelChange(db, { sessionId: session.id, fromModel: 'sonnet', toModel: 'opus', reason: 'stepped up' });
  recordModelChange(db, { sessionId: session.id, fromModel: 'opus', toModel: 'opus', reason: 'manual fable pass' });
  const rows = listModelUsage(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].to_model, 'opus'); // newest first
  assert.equal(rows[0].reason, 'manual fable pass');
  assert.equal(rows[0].session_name, 'mm-alpha-main-dev-x');
  db.close();
});

test('model usage can be filtered to one project', () => {
  const db = tempDb();
  const a = addProject(db, { name: 'alpha', folder: 'C:\\x' });
  const b = addProject(db, { name: 'beta', folder: 'C:\\y' });
  const sa = registerSession(db, { role: 'architect', projectId: a.id, name: 'mm-alpha-main', folder: 'C:\\x' });
  const sb = registerSession(db, { role: 'architect', projectId: b.id, name: 'mm-beta-main', folder: 'C:\\y' });
  recordModelChange(db, { sessionId: sa.id, fromModel: 'sonnet', toModel: 'opus', reason: 'a' });
  recordModelChange(db, { sessionId: sb.id, fromModel: 'sonnet', toModel: 'haiku', reason: 'b' });
  const forAlpha = listModelUsage(db, { projectId: a.id });
  assert.equal(forAlpha.length, 1);
  assert.equal(forAlpha[0].project, 'alpha');
  db.close();
});
