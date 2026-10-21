import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { claim, listClaims, release, releaseAll } from '../src/roster/claims.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function setup(t: TestContext) {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  const main = requireWorkstream(db, project.id, 'main');
  const ui = requireWorkstream(db, project.id, 'ui');
  const a = registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const b = registerSession(db, { role: 'architect', projectId: project.id, workstreamId: ui.id, name: 'mm-alpha-ui' });
  return { db, project, a, b };
}

test('a second claim is refused and names the holder', (t) => {
  const { db, project, a, b } = setup(t);
  assert.deepEqual(claim(db, project.id, 'package.json', a.id, new Date('2026-10-21T08:00:00.000Z')), { ok: true, path: 'package.json' });
  assert.deepEqual(claim(db, project.id, 'package.json', a.id), { ok: true, path: 'package.json' });
  const refused = claim(db, project.id, '.\\PACKAGE.json', b.id);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.holder.name, 'mm-alpha-main');
  assert.equal(refused.holder.session_id, a.id);
  assert.match(refused.message, /package\.json is claimed by mm-alpha-main \(session #\d+, architect\) since 2026-10-21T08:00:00\.000Z/);
});

test("only the holder releases; releaseAll frees a session's claims", (t) => {
  const { db, project, a, b } = setup(t);
  claim(db, project.id, 'src\\shared\\schema.ts', a.id);
  claim(db, project.id, 'build:heavy', a.id);
  assert.deepEqual(listClaims(db, project.id).map((c) => c.path), ['src/shared/schema.ts', 'build:heavy']);
  assert.equal(release(db, project.id, 'src/shared/schema.ts', b.id), false);
  assert.equal(release(db, project.id, 'src/shared/schema.ts', a.id), true);
  assert.equal(claim(db, project.id, 'src/shared/schema.ts', b.id).ok, true);
  assert.equal(releaseAll(db, a.id), 1);
  assert.deepEqual(listClaims(db, project.id).map((c) => c.path), ['src/shared/schema.ts']);
});
