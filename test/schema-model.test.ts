import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRoster } from '../src/roster/db.ts';
import { addProject, getProjectDefaultModel, setProjectDefaultModel, requireProjectById } from '../src/roster/projects.ts';
import { registerSession, requireSession, setSessionModel, setSessionScores } from '../src/roster/sessions.ts';

let dir: string;
after(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function tempDb(): DatabaseSync {
  dir = mkdtempSync(join(tmpdir(), 'mm-schema-'));
  return openRoster(join(dir, 'roster.db'));
}

test('a fresh roster has the new columns and the model_ledger table', () => {
  const db = tempDb();
  const sessionCols = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(sessionCols.includes('model'));
  assert.ok(sessionCols.includes('complexity'));
  assert.ok(sessionCols.includes('clarity'));
  const projectCols = (db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(projectCols.includes('default_model'));
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'model_ledger'").all() as { name: string }[]);
  assert.equal(tables.length, 1);
  db.close();
});

test('an old sessions table is migrated to gain the new columns', () => {
  const db = tempDb();
  db.close();
  // Rebuild a bare pre-migration sessions table on the same path, then re-open: migrate must add the columns.
  const bare = new DatabaseSync(join(dir, 'roster.db'));
  bare.exec(`DROP TABLE sessions; CREATE TABLE sessions (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, parent_id INTEGER, project_id INTEGER, workstream_id INTEGER,
    name TEXT, pid INTEGER, wrapper_pid INTEGER, claude_session_id TEXT, folder TEXT,
    state TEXT NOT NULL, last_checkin_at TEXT, created_at TEXT NOT NULL);`);
  bare.close();
  const reopened = openRoster(join(dir, 'roster.db'));
  const cols = (reopened.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('model') && cols.includes('complexity') && cols.includes('clarity'));
  reopened.close();
});

test('a project default model round-trips; a new project has none', () => {
  const db = tempDb();
  const project = addProject(db, { name: 'alpha', folder: 'C:\\x' });
  assert.equal(getProjectDefaultModel(db, project.id), null);
  setProjectDefaultModel(db, project.id, 'haiku');
  assert.equal(getProjectDefaultModel(db, project.id), 'haiku');
  assert.equal(requireProjectById(db, project.id).default_model, 'haiku');
  db.close();
});

test('session model and scores round-trip on a session row', () => {
  const db = tempDb();
  const project = addProject(db, { name: 'alpha', folder: 'C:\\x' });
  const session = registerSession(db, { role: 'developer', projectId: project.id, name: 'mm-alpha-main-dev-x', folder: 'C:\\x' });
  setSessionModel(db, session.id, 'opus');
  setSessionScores(db, session.id, 5, 2);
  const loaded = requireSession(db, session.id);
  assert.equal(loaded.model, 'opus');
  assert.equal(loaded.complexity, 5);
  assert.equal(loaded.clarity, 2);
  db.close();
});
