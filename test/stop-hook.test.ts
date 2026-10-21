import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { runStopHook } from '../src/hooks/stop.ts';
import { answerItem, getItem, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { getSession, registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempDir, tempRoster } from './helpers.ts';

const script = join(import.meta.dirname, '..', 'scripts', 'stop-hook.ts');

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const env = { MM_SESSION_ID: String(arch.id), MM_ROLE: 'architect', MM_ROSTER_DB: process.env.MM_ROSTER_DB };
  return { db, desk, arch, env };
}

test('blocks once when unseen items exist, then lets the session stop', (t) => {
  const { db, desk, arch, env } = setup(t);
  const item = raiseItem(db, { kind: 'question', body: 'Which database?', raisedBy: desk.id, addressedTo: arch.id });
  const now = new Date('2026-10-21T09:30:00.000Z');
  const first = runStopHook(env, now);
  assert.equal(first?.decision, 'block');
  assert.match(first?.reason ?? '', new RegExp(`#${item.id} \\[question, open\\] Which database\\?`));
  assert.equal(getItem(db, item.id)?.seen, 1);
  assert.equal(getSession(db, arch.id)?.last_checkin_at, now.toISOString());
  assert.equal(runStopHook(env), null);
});

test('an answer to the architect\'s sign-off blocks once more, with the verbatim answer', (t) => {
  const { db, arch, env } = setup(t);
  const signoff = raiseItem(db, { kind: 'signoff', body: 'Plan v1', raisedBy: arch.id });
  assert.equal(runStopHook(env), null); // addressed to the front desk, not to the architect
  answerItem(db, signoff.id, 'Approved; add one e2e test.');
  const blocked = runStopHook(env);
  assert.match(blocked?.reason ?? '', /Answer \(verbatim\): Approved; add one e2e test\./);
  assert.equal(runStopHook(env), null);
});

test('does nothing when MM_SESSION_ID is unset', (t) => {
  const path = join(tempDir(t), 'never.db');
  assert.equal(runStopHook({ MM_ROSTER_DB: path }), null);
  assert.equal(existsSync(path), false);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MM_')));
  const result = spawnSync(process.execPath, [script], { env, input: '{}', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('the entry script prints a block decision for a Multi-Manager session', (t) => {
  const { db, desk, arch, env } = setup(t);
  raiseItem(db, { kind: 'info', body: 'Front desk restarted', raisedBy: desk.id, addressedTo: arch.id });
  const result = spawnSync(process.execPath, [script], { env: { ...process.env, ...env }, input: '{"stop_hook_active":false}', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { decision: string; reason: string };
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /Front desk restarted/);
});
