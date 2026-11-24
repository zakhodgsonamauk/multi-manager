import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { checkBackend } from '../src/backends/checks.ts';
import { BACKENDS, DEFAULT_PREFERENCE, backendEnv, computeLimits } from '../src/backends/definitions.ts';
import type { BackendName } from '../src/backends/definitions.ts';
import { acquireProxy, proxyStatus, reconcileProxy, releaseProxy } from '../src/backends/proxy.ts';
import { tempDir } from './helpers.ts';

const FAKE_KEY = 'fake-box-key-0123456789abcdef0123456789abcdef';

type Handler = (url: string, auth: string | undefined) => { status?: number; body: unknown };

/** A fake local HTTP server. Returns its address. */
async function fakeServer(t: TestContext, handler: Handler): Promise<string> {
  const srv: Server = createServer((req, res) => {
    const r = handler(req.url ?? '', req.headers.authorization);
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => srv.close(() => resolve())));
  const addr = srv.address();
  assert.ok(addr && typeof addr === 'object');
  return `http://127.0.0.1:${addr.port}`;
}

const noRegistry = async () => null;
const boxServer = (t: TestContext, state: string, ctx = 262144) =>
  fakeServer(t, (url, auth) => {
    if (auth !== `Bearer ${FAKE_KEY}`) return { status: 401, body: {} };
    if (url === '/v1/models') return { body: { data: [{ id: 'qwen-fake', max_model_len: ctx }] } };
    if (url === '/status') return { body: { state } };
    return { status: 404, body: {} };
  });

test('no backend env holds a secret; box names LEADERGPU_LLM_KEY as its key source', () => {
  const info = { model: 'some-model', contextTokens: 262144, baseUrl: 'http://127.0.0.1:47832' };
  const names: BackendName[] = ['claude', 'box', 'strata', 'glm'];
  for (const name of names) {
    const { env } = backendEnv(name, 'sonnet', info);
    for (const [k, v] of Object.entries(env)) {
      assert.ok(!v.includes(FAKE_KEY), `${name} ${k}`);
      assert.ok(!/^(sk-|Bearer )/.test(v), `${name} ${k} looks like a key`);
      assert.ok(!/[A-Za-z0-9_-]{32,}/.test(v), `${name} ${k} looks like a long token`);
    }
  }
  const box = backendEnv('box', 'sonnet', info);
  assert.deepEqual(box.keySource, { fromEnvVar: 'LEADERGPU_LLM_KEY', registryFallback: true, setAs: 'ANTHROPIC_AUTH_TOKEN' });
  assert.equal(box.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(backendEnv('claude', 'opus').keySource, null);
  assert.deepEqual(backendEnv('claude', 'opus').env, {});
  assert.ok(BACKENDS.strata.needsProxy);
});

test('tier mapping and preference list', () => {
  for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
    const box = backendEnv('box', tier, { model: 'qwen-fake', contextTokens: 262144 }).env;
    assert.equal(box.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'qwen-fake');
    assert.equal(box.ANTHROPIC_DEFAULT_SONNET_MODEL, 'qwen-fake');
    assert.equal(box.ANTHROPIC_DEFAULT_OPUS_MODEL, 'qwen-fake');
    const glm = backendEnv('glm', tier).env;
    assert.equal(glm.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'glm-5.3:cloud');
    assert.equal(glm.ANTHROPIC_DEFAULT_SONNET_MODEL, 'glm-5.3:cloud');
    assert.equal(glm.ANTHROPIC_DEFAULT_OPUS_MODEL, 'glm-5.3:cloud');
    assert.equal(glm.ANTHROPIC_BASE_URL, 'http://localhost:11434');
  }
  assert.deepEqual([...DEFAULT_PREFERENCE], ['glm', 'box', 'strata']);
  assert.ok(!('gpt' in BACKENDS) && !('minimax' in BACKENDS));
});

test('context margin matches the Dropbox claude-on-box.bat', () => {
  // By hand from claude-on-box.bat, BOX_CONTEXT=262144:
  //   BOX_OUTPUT_CEILING = 262144 / 8 = 32768; BOX_MAX_OUTPUT_TOKENS 32000 is not above it, so stays 32000.
  //   BOX_COMPACT_AT = 262144 - 32000 - 262144 / 16 = 262144 - 32000 - 16384 = 213760.
  assert.deepEqual(computeLimits(262144), { maxOutputTokens: 32000, compactAt: 213760 });
  const env = backendEnv('box', 'haiku', { model: 'qwen-fake', contextTokens: 262144 }).env;
  assert.equal(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '213760');
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '32000');
  // Short model: 65536 / 8 = 8192 caps the reply; compact at 65536 - 8192 - 4096 = 53248.
  assert.deepEqual(computeLimits(65536), { maxOutputTokens: 8192, compactAt: 53248 });
});

test('box check: ready, slowed, unreachable, no key', async (t) => {
  const ok = await boxServer(t, 'ready');
  const r = await checkBackend('box', { boxUrl: ok, env: { LEADERGPU_LLM_KEY: FAKE_KEY }, readRegistry: noRegistry });
  assert.deepEqual([r.ready, r.model, r.contextTokens, r.slowed], [true, 'qwen-fake', 262144, false]);
  assert.ok(!JSON.stringify(r).includes(FAKE_KEY));

  const slow = await boxServer(t, 'slowed');
  const s = await checkBackend('box', { boxUrl: slow, env: { LEADERGPU_LLM_KEY: FAKE_KEY }, readRegistry: noRegistry });
  assert.equal(s.ready, true);
  assert.equal(s.slowed, true);
  assert.match(s.note, /slowed/);

  const down = await checkBackend('box', {
    boxUrl: 'http://127.0.0.1:1',
    env: { LEADERGPU_LLM_KEY: FAKE_KEY },
    readRegistry: noRegistry,
    timeoutMs: 1000,
  });
  assert.equal(down.ready, false);
  assert.equal(down.note, 'the LeaderGPU box is not reachable');

  const noKey = await checkBackend('box', { boxUrl: ok, env: {}, readRegistry: noRegistry });
  assert.equal(noKey.ready, false);
  assert.match(noKey.note, /LEADERGPU_LLM_KEY/);

  const fromRegistry = await checkBackend('box', { boxUrl: ok, env: {}, readRegistry: async () => FAKE_KEY });
  assert.equal(fromRegistry.ready, true);
});

test('strata check: ready, no loaded model, litellm missing, unreachable', async (t) => {
  const loaded = await fakeServer(t, () => ({
    body: { data: [{ id: 'idle', status: { value: 'unloaded' } }, { id: 'big-model', status: { value: 'loaded' }, context_length: 524288 }] },
  }));
  const fine = async () => null;
  const r = await checkBackend('strata', { strataUrl: loaded, litellmProblem: fine, litellmProgramProblem: fine });
  assert.deepEqual([r.ready, r.model, r.contextTokens], [true, 'big-model', 524288]);

  const none = await fakeServer(t, () => ({ body: { data: [{ id: 'idle', status: { value: 'unloaded' } }] } }));
  const n = await checkBackend('strata', { strataUrl: none, litellmProblem: fine, litellmProgramProblem: fine });
  assert.equal(n.ready, false);
  assert.match(n.note, /no model is loaded/);

  const missing = await checkBackend('strata', {
    strataUrl: loaded,
    litellmProblem: async () => 'litellm is not installed: run python -m pip install "litellm[proxy]"',
  });
  assert.equal(missing.ready, false);
  assert.equal(missing.note, 'litellm is not installed: run python -m pip install "litellm[proxy]"');

  const down = await checkBackend('strata', { strataUrl: 'http://127.0.0.1:1', litellmProblem: fine, litellmProgramProblem: fine, timeoutMs: 1000 });
  assert.equal(down.ready, false);
});

test('glm check: lists the model, lacks it, not running', async (t) => {
  const has = await fakeServer(t, () => ({ body: { models: [{ name: 'glm-5.3:cloud' }] } }));
  const r = await checkBackend('glm', { ollamaUrl: has });
  assert.deepEqual([r.ready, r.model], [true, 'glm-5.3:cloud']);
  const lacks = await fakeServer(t, () => ({ body: { models: [{ name: 'other:latest' }] } }));
  assert.equal((await checkBackend('glm', { ollamaUrl: lacks })).ready, false);
  const down = await checkBackend('glm', { ollamaUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
  assert.equal(down.ready, false);
  assert.match(down.note, /Ollama is not running/);
});

test('strata check: litellm imports but the litellm program file is missing', async (t) => {
  const loaded = await fakeServer(t, () => ({ body: { data: [{ id: 'm', status: { value: 'loaded' }, context_length: 524288 }] } }));
  const r = await checkBackend('strata', {
    strataUrl: loaded,
    litellmProblem: async () => null,
    litellmProgramProblem: async () => 'litellm.exe not found where Python keeps its programs: run python -m pip install "litellm[proxy]"',
  });
  assert.equal(r.ready, false);
  assert.match(r.note, /^litellm\.exe not found/);
});

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    if (!pidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** A fake proxy program. It also starts a child process (pid written to child.pid) to prove the whole tree is killed. */
function fakeProxy(dir: string) {
  const script = join(dir, 'fake-proxy.js');
  writeFileSync(
    script,
    [
      "const { spawn } = require('node:child_process');",
      "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });",
      "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'child.pid'), String(c.pid));",
      "require('node:http').createServer((q, s) => s.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');",
    ].join('\n'),
  );
  return { command: process.execPath, args: (port: number) => [script, String(port)] };
}

function startProxyOptions(t: TestContext) {
  const dir = tempDir(t);
  const o = { dir, program: fakeProxy(dir), waitMs: 15000 };
  t.after(async () => {
    const s = await reconcileProxy([], dir);
    assert.equal(s.running, false);
  });
  return o;
}

function readChildPid(dir: string): number {
  return Number(readFileSync(join(dir, 'child.pid'), 'utf8'));
}

test('proxy lifecycle: first user starts, second reuses, last release stops (whole tree, config removed)', async (t) => {
  const o = startProxyOptions(t);
  const dir = o.dir;
  writeFileSync(join(dir, 'strata-litellm.yaml'), 'x');

  const first = await acquireProxy('s1', o);
  assert.equal(first.started, true);
  assert.deepEqual(await proxyStatus(dir), { running: true, pid: first.pid, port: first.port, users: ['s1'] });

  const again = await acquireProxy('s1', o); // idempotent per session
  assert.equal(again.started, false);
  assert.deepEqual((await proxyStatus(dir)).users, ['s1']);

  const second = await acquireProxy('s2', o);
  assert.equal(second.started, false);
  assert.equal(second.pid, first.pid);
  assert.deepEqual((await proxyStatus(dir)).users, ['s1', 's2']);

  const afterOne = await releaseProxy('s1', dir);
  assert.deepEqual([afterOne.running, afterOne.users], [true, ['s2']]);
  assert.ok(pidAlive(first.pid));
  assert.deepEqual((await releaseProxy('s1', dir)).users, ['s2']); // repeat release changes nothing

  await new Promise((r) => setTimeout(r, 300)); // let the fake write child.pid
  const childPid = readChildPid(dir);
  assert.ok(pidAlive(childPid));
  const afterLast = await releaseProxy('s2', dir);
  assert.equal(afterLast.running, false);
  assert.ok(await waitDead(first.pid), 'proxy still alive after last release');
  assert.ok(await waitDead(childPid), 'proxy child still alive after last release');
  assert.ok(!existsSync(join(dir, 'strata-proxy.json')));
  assert.ok(!existsSync(join(dir, 'strata-litellm.yaml')));
});

test('a stale proxy file from a dead process is cleaned up and a new proxy starts', async (t) => {
  const o = startProxyOptions(t);
  const dir = o.dir;
  const dead = spawn(process.execPath, ['-e', '0']);
  const deadPid = dead.pid as number;
  await new Promise((r) => dead.once('exit', r));
  const stale = JSON.stringify({ pid: deadPid, port: 47835, image: 'node', users: ['x', 'y'] });
  writeFileSync(join(dir, 'strata-proxy.json'), stale);

  assert.deepEqual(await proxyStatus(dir), { running: false, pid: null, port: null, users: [] });
  assert.ok(!existsSync(join(dir, 'strata-proxy.json')));

  writeFileSync(join(dir, 'strata-proxy.json'), stale);
  const fresh = await acquireProxy('s1', o);
  assert.equal(fresh.started, true);
  assert.deepEqual((await proxyStatus(dir)).users, ['s1']);
  await releaseProxy('s1', dir);
  assert.ok(await waitDead(fresh.pid));
});

test('a proxy that never starts is not left running and counts no user', async (t) => {
  const dir = tempDir(t);
  const bad = { command: process.execPath, args: () => ['-e', 'setTimeout(()=>{}, 60000)'] };
  await assert.rejects(acquireProxy('s1', { dir, program: bad, waitMs: 600 }), /did not start/);
  assert.ok(!existsSync(join(dir, 'strata-proxy.json')));
});

test('a live pid with a silent port is killed and replaced', async (t) => {
  const o = startProxyOptions(t);
  const hung = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const hungPid = hung.pid as number;
  t.after(() => {
    try {
      process.kill(hungPid);
    } catch {
      // already gone
    }
  });
  writeFileSync(join(o.dir, 'strata-proxy.json'), JSON.stringify({ pid: hungPid, port: 47839, image: 'node', users: ['old'] }));

  const fresh = await acquireProxy('s1', o);
  assert.equal(fresh.started, true);
  assert.notEqual(fresh.pid, hungPid);
  assert.ok(await waitDead(hungPid), 'hung proxy was orphaned');
  assert.deepEqual((await proxyStatus(o.dir)).users, ['s1']);
});

test('a reused pid that belongs to another program is not killed', async (t) => {
  const o = startProxyOptions(t);
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const otherPid = other.pid as number;
  t.after(() => {
    try {
      process.kill(otherPid);
    } catch {
      // already gone
    }
  });
  // The roster recorded litellm at this pid, but it is now a node program.
  writeFileSync(join(o.dir, 'strata-proxy.json'), JSON.stringify({ pid: otherPid, port: 47839, image: 'litellm', users: ['old'] }));
  assert.deepEqual(await proxyStatus(o.dir), { running: false, pid: null, port: null, users: [] });
  assert.ok(pidAlive(otherPid), 'killed a program that was not ours');
});

test('proxy dies mid-use: old and new sessions release in any order and it ends stopped', async (t) => {
  const o = startProxyOptions(t);
  const first = await acquireProxy('old', o);
  process.kill(first.pid);
  assert.ok(await waitDead(first.pid));

  const second = await acquireProxy('new', o);
  assert.equal(second.started, true);
  assert.notEqual(second.pid, first.pid);

  const afterOld = await releaseProxy('old', o.dir); // the old session's release must not drain the new count
  assert.deepEqual([afterOld.running, afterOld.users], [true, ['new']]);
  const afterNew = await releaseProxy('new', o.dir);
  assert.deepEqual([afterNew.running, afterNew.users], [false, []]);
  assert.ok(await waitDead(second.pid));
});

test('reconcileProxy drops a crashed session and stops the proxy when none are left', async (t) => {
  const o = startProxyOptions(t);
  const p = await acquireProxy('alive', o);
  await acquireProxy('crashed', o);
  const after = await reconcileProxy(['alive'], o.dir);
  assert.deepEqual([after.running, after.users], [true, ['alive']]);
  const none = await reconcileProxy([], o.dir);
  assert.deepEqual([none.running, none.users], [false, []]);
  assert.ok(await waitDead(p.pid));
  assert.ok(!existsSync(join(o.dir, 'strata-proxy.json')));
});

test('overlapping acquires start exactly one proxy', async (t) => {
  const o = startProxyOptions(t);
  const results = await Promise.all(['a', 'b', 'c'].map((id) => acquireProxy(id, o)));
  assert.equal(results.filter((r) => r.started).length, 1);
  assert.equal(new Set(results.map((r) => r.pid)).size, 1);
  assert.deepEqual((await proxyStatus(o.dir)).users.sort(), ['a', 'b', 'c']);
  await Promise.all(['a', 'b', 'c'].map((id) => releaseProxy(id, o.dir)));
  assert.ok(await waitDead(results[0].pid));
});

