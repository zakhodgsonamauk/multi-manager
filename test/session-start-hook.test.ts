import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runSessionStartHook } from '../src/hooks/session-start.ts';
import { getItem, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { getSession, registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempDir, tempRoster } from './helpers.ts';

test('SessionStart checks in and puts open items for this session into context', (t) => {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' }, new Date('2026-10-21T08:00:00.000Z'));
  const item = raiseItem(db, { kind: 'question', body: 'Use Postgres?', addressedTo: arch.id, raisedBy: desk.id });
  const env = { MM_SESSION_ID: String(arch.id), MM_ROLE: 'architect', MM_ROSTER_DB: process.env.MM_ROSTER_DB };
  const now = new Date('2026-10-21T09:00:00.000Z');
  const output = runSessionStartHook(env, now);
  assert.equal(output?.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output?.hookSpecificOutput.additionalContext ?? '', new RegExp(`roster session #${arch.id} \\(architect\\)`));
  assert.match(output?.hookSpecificOutput.additionalContext ?? '', new RegExp(`#${item.id} \\[question, open\\] Use Postgres\\?`));
  assert.equal(getSession(db, arch.id)?.last_checkin_at, now.toISOString());
  assert.equal(getItem(db, item.id)?.seen, 1);
});

test('SessionStart does nothing without MM_SESSION_ID and creates no database', (t) => {
  const path = join(tempDir(t), 'never.db');
  assert.equal(runSessionStartHook({ MM_ROSTER_DB: path }), null);
  assert.equal(existsSync(path), false);
});

test('the SessionStart entry script is silent outside Multi-Manager sessions', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MM_')));
  const result = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'session-start-hook.ts')], { env, input: '{}', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
