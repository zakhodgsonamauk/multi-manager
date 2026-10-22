import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Command } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import { addProject, setProjectDefaultModel } from '../src/roster/projects.ts';
import { requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

/** The claude arguments inside the wrapper script that wt.exe is given (last argument, base64). */
function claudeArgsOf(command: Command): string[] {
  const line = decodeCommand(command.args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  return [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

function modelOf(command: Command): string | undefined {
  const args = claudeArgsOf(command);
  const at = args.indexOf('--model');
  return at === -1 ? undefined : args[at + 1];
}

/** Nothing real is launched: every run is recorded and succeeds. */
function fakeDeps() {
  const runs: Command[] = [];
  let nextPid = 4000;
  const deps: LaunchDeps = {
    run: async (command) => {
      runs.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: () => {},
    waitForPid: async () => (nextPid += 1),
    findPid: async () => null,
    ownsProcess: async () => true,
    waitForWrapperPid: async () => null,
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
  };
  return { deps, runs };
}

/** A temp roster (closed and deleted by the helper after each test) with a front desk and one project, no architect yet. */
function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha' });
  const fake = fakeDeps();
  const ctx: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  return { db, desk, project, ctx, runs: fake.runs };
}

async function withArchitect(t: TestContext) {
  const s = setup(t);
  const { session: architect } = await launchArchitect(s.ctx, { project: 'alpha', parentId: s.desk.id });
  return { ...s, architect };
}

test('a hard, vague task launches its developer on opus and records model and scores', async (t) => {
  const { db, architect, ctx, runs } = await withArchitect(t);
  const { session } = await launchDeveloper(ctx, { architectId: architect.id, task: 'redesign auth', label: 'auth', complexity: 5, clarity: 1 });
  assert.equal(modelOf(runs.at(-1)!), 'opus');
  const row = requireSession(db, session.id);
  assert.deepEqual([row.model, row.complexity, row.clarity], ['opus', 5, 1]);
});

test('a small, fully specified task launches its developer on haiku', async (t) => {
  const { db, architect, ctx, runs } = await withArchitect(t);
  const { session } = await launchDeveloper(ctx, { architectId: architect.id, task: 'fix a typo', label: 'typo', complexity: 1, clarity: 5 });
  assert.equal(modelOf(runs.at(-1)!), 'haiku');
  const row = requireSession(db, session.id);
  assert.deepEqual([row.model, row.complexity, row.clarity], ['haiku', 1, 5]);
});

test('an architect launches on sonnet when the project has no default', async (t) => {
  const { db, desk, ctx, runs } = setup(t);
  const { session, existing } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(existing, false);
  assert.equal(runs.length, 1);
  assert.equal(modelOf(runs[0]), 'sonnet');
  assert.equal(requireSession(db, session.id).model, 'sonnet');
});

test('an architect launches on the project default when one is set', async (t) => {
  const { db, desk, project, ctx, runs } = setup(t);
  setProjectDefaultModel(db, project.id, 'opus');
  const { session } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(modelOf(runs[0]), 'opus');
  assert.equal(requireSession(db, session.id).model, 'opus');
});

test('an unscored developer falls back to the project default, and leaves its scores empty', async (t) => {
  const { db, project, architect, ctx, runs } = await withArchitect(t);
  setProjectDefaultModel(db, project.id, 'haiku');
  const { session } = await launchDeveloper(ctx, { architectId: architect.id, task: 'tidy the docs', label: 'docs' });
  assert.equal(modelOf(runs.at(-1)!), 'haiku');
  const row = requireSession(db, session.id);
  assert.deepEqual([row.model, row.complexity, row.clarity], ['haiku', null, null]);
});

test('an unscored developer with no project default runs on sonnet', async (t) => {
  const { db, architect, ctx, runs } = await withArchitect(t);
  const { session } = await launchDeveloper(ctx, { architectId: architect.id, task: 'tidy the docs', label: 'docs' });
  assert.equal(modelOf(runs.at(-1)!), 'sonnet');
  assert.equal(requireSession(db, session.id).model, 'sonnet');
});

test('an explicit model wins over scores and the project default', async (t) => {
  const { db, project, architect, ctx, runs } = await withArchitect(t);
  setProjectDefaultModel(db, project.id, 'haiku');
  const { session } = await launchDeveloper(ctx, { architectId: architect.id, task: 'x', label: 'x', complexity: 1, clarity: 5, model: 'opus' });
  assert.equal(modelOf(runs.at(-1)!), 'opus');
  assert.equal(requireSession(db, session.id).model, 'opus');
});
