import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import {
  checkIn,
  frontDesk,
  registerSession,
  runningArchitect,
  runningChildren,
  sessionTree,
  setSessionPid,
  setSessionState,
  startFrontDesk,
} from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function setup(t: TestContext) {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  return { db, project, main: requireWorkstream(db, project.id, 'main'), ui: requireWorkstream(db, project.id, 'ui') };
}

test('there is one front-desk record, created on demand and reused on start', (t) => {
  const { db } = setup(t);
  const placeholder = frontDesk(db);
  assert.equal(placeholder.state, 'stopped');
  assert.equal(frontDesk(db).id, placeholder.id);
  const started = startFrontDesk(db, 'mm-front-desk');
  assert.equal(started.id, placeholder.id);
  assert.equal(started.state, 'running');
  assert.equal(started.name, 'mm-front-desk');
});

test('the session tree nests by parent and hides stopped leaves unless asked', (t) => {
  const { db, project, main, ui } = setup(t);
  const desk = startFrontDesk(db);
  const archMain = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const archUi = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: ui.id, name: 'mm-alpha-ui' });
  const dev = registerSession(db, { role: 'developer', parentId: archMain.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main-dev-login' });
  const tree = sessionTree(db);
  assert.deepEqual(tree.map((n) => n.id), [desk.id]);
  assert.deepEqual(tree[0].children.map((n) => n.id), [archMain.id, archUi.id]);
  assert.deepEqual(tree[0].children[0].children.map((n) => n.id), [dev.id]);
  setSessionState(db, dev.id, 'stopped');
  assert.deepEqual(sessionTree(db)[0].children[0].children, []);
  assert.deepEqual(sessionTree(db, { includeStopped: true })[0].children[0].children.map((n) => n.id), [dev.id]);
  assert.deepEqual(runningChildren(db, archMain.id), []);
});

test('check-in records the time; unknown sessions are rejected', (t) => {
  const { db } = setup(t);
  const desk = startFrontDesk(db);
  const at = new Date('2026-10-21T10:00:00.000Z');
  assert.equal(checkIn(db, desk.id, at).last_checkin_at, '2026-10-21T10:00:00.000Z');
  assert.throws(() => checkIn(db, 999), /Unknown session #999/);
});

test('one running architect per workstream; pid is stored', (t) => {
  const { db, project, main } = setup(t);
  const arch = registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  setSessionPid(db, arch.id, 4242);
  assert.equal(runningArchitect(db, main.id)?.pid, 4242);
  assert.throws(() => registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'again' }), /UNIQUE/);
  setSessionState(db, arch.id, 'stopped');
  assert.equal(runningArchitect(db, main.id), undefined);
  registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
});
