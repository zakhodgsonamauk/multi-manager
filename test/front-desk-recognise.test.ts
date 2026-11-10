import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { LaunchContext } from '../src/launch/launcher.ts';
import { createFrontDeskProbe } from '../src/roster/identity.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { currentIdentity, identityFromEnv, me, type ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

type Env = Record<string, string | undefined>;

interface Harness {
  db: DatabaseSync;
  ctx: ToolContext;
  reads: number[];
  setFile: (value: unknown) => void;
  setNowMs: (ms: number) => void;
}

/** A roster server's view: identity from the environment, a probe with a fake session file and parent pid. */
function harness(t: TestContext, env: Env, parent: number | null = 4242): Harness {
  const db = tempRoster(t);
  const reads: number[] = [];
  let file: unknown = null;
  let nowMs = 0;
  const probe = createFrontDeskProbe({
    db,
    env,
    parentPid: () => parent,
    readSessionFile: (pid) => {
      reads.push(pid);
      return file;
    },
    nowMs: () => nowMs,
  });
  const ctx: ToolContext = {
    db,
    identity: identityFromEnv(env),
    pluginRoot: '.',
    launch: { db, deps: {} as LaunchContext['deps'], pluginRoot: '.', env: {} },
    probe,
  };
  return {
    db,
    ctx,
    reads,
    setFile: (value) => {
      file = value;
    },
    setNowMs: (ms) => {
      nowMs = ms;
    },
  };
}

const NOT_REGISTERED = /This session is not registered with the roster\. Front desk: run \/multi-manager:front-desk first\./;

test('the front desk whose session file says mm-front-desk is recognised without start_front_desk', (t) => {
  const h = harness(t, {});
  const desk = startFrontDesk(h.db, 'mm-front-desk');
  h.ctx.identity = { sessionId: null, role: null }; // a fresh server: no environment identity
  h.setFile({ name: 'mm-front-desk', status: 'idle' });
  assert.equal(me(h.ctx).id, desk.id);
  assert.deepEqual(h.ctx.identity, { sessionId: desk.id, role: 'front-desk' });
  assert.equal(h.reads.at(-1), 4242);
  assert.equal(me(h.ctx).name, 'mm-front-desk');
});

test('a cluster front desk named mm-front-desk-alpha is recognised when its environment names it', (t) => {
  const env = { MM_FRONT_DESK_NAME: 'mm-front-desk-alpha' };
  const h = harness(t, env);
  const desk = startFrontDesk(h.db, 'mm-front-desk-alpha');
  h.setFile({ name: 'mm-front-desk-alpha' });
  assert.equal(me(h.ctx).id, desk.id);
  assert.equal(h.ctx.identity.role, 'front-desk');
});

test('recognition checks in the front desk but leaves its name and state alone', (t) => {
  const h = harness(t, {});
  const desk = startFrontDesk(h.db, 'mm-front-desk');
  h.db.prepare("UPDATE sessions SET last_checkin_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(desk.id);
  h.setFile({ name: 'mm-front-desk' });
  me(h.ctx);
  const after = h.db.prepare('SELECT name, state, last_checkin_at FROM sessions WHERE id = ?').get(desk.id) as Record<string, string>;
  assert.equal(after.name, 'mm-front-desk');
  assert.equal(after.state, 'running');
  assert.notEqual(after.last_checkin_at, '2000-01-01T00:00:00.000Z');
});

test('a session whose file name is another project or has no name stays unregistered', (t) => {
  for (const file of [{ name: 'mm-multi-manager-x' }, {}, { name: '' }, null, 'not an object']) {
    const h = harness(t, {});
    startFrontDesk(h.db, 'mm-front-desk');
    h.setFile(file);
    assert.throws(() => me(h.ctx), NOT_REGISTERED, `file ${JSON.stringify(file)}`);
    assert.equal(h.ctx.identity.sessionId, null);
  }
});

test('no record named like the session file means no recognition', (t) => {
  const h = harness(t, {});
  registerSession(h.db, { role: 'architect', name: 'mm-multi-manager-main' });
  h.setFile({ name: 'mm-front-desk' });
  assert.throws(() => me(h.ctx), NOT_REGISTERED);
});

test('no parent process id means no recognition and no file read', (t) => {
  const h = harness(t, {}, null);
  startFrontDesk(h.db, 'mm-front-desk');
  h.setFile({ name: 'mm-front-desk' });
  assert.throws(() => me(h.ctx), NOT_REGISTERED);
  assert.deepEqual(h.reads, []);
});

test('an architect environment identity wins and the session file is never read', (t) => {
  const h = harness(t, {});
  const arch = registerSession(h.db, { role: 'architect', name: 'mm-multi-manager-main' });
  h.ctx.identity = identityFromEnv({ MM_SESSION_ID: String(arch.id), MM_ROLE: 'architect' });
  startFrontDesk(h.db, 'mm-front-desk');
  h.setFile({ name: 'mm-front-desk' });
  assert.deepEqual(h.ctx.identity, { sessionId: arch.id, role: 'architect' });
  assert.equal(me(h.ctx).id, arch.id);
  assert.deepEqual(h.reads, []);
});

test('a role without a session id from the environment is not overridden by the session file', (t) => {
  const h = harness(t, { MM_ROLE: 'architect' });
  startFrontDesk(h.db, 'mm-front-desk');
  h.setFile({ name: 'mm-front-desk' });
  assert.equal(currentIdentity(h.ctx).role, 'architect');
  assert.deepEqual(h.reads, []);
});

test('a session file written after the server started is recognised by a later tool call', (t) => {
  const h = harness(t, {});
  startFrontDesk(h.db, 'mm-front-desk');
  assert.throws(() => me(h.ctx), NOT_REGISTERED);
  h.setFile({ name: 'mm-front-desk' });
  assert.equal(me(h.ctx).name, 'mm-front-desk');
});

test('the monitor check turns active once recognised, trying at most once every 30 s while unrecognised', (t) => {
  const h = harness(t, {});
  startFrontDesk(h.db, 'mm-front-desk');
  const active = () => currentIdentity(h.ctx, { throttled: true }).role === 'front-desk';
  assert.equal(active(), false);
  h.setFile({ name: 'mm-front-desk' });
  h.setNowMs(1_000);
  assert.equal(active(), false, 'inside the 30 s window: not tried again');
  h.setNowMs(30_000);
  assert.equal(active(), true);
  assert.equal(h.ctx.identity.role, 'front-desk');
});
