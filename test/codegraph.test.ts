import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODE_GRAPH_SERVER_SPEC,
  CODE_GRAPH_TIMEOUT_MS,
  codeGraphSpawnOptions,
  disableCodeGraph,
  enableCodeGraph,
  type CodeGraphRunOptions,
  type CodeGraphRunner,
  type CodeGraphRunResult,
} from '../src/codegraph/codegraph.ts';

interface Call {
  file: string;
  args: string[];
  options: CodeGraphRunOptions;
}

const LOCAL_GET = { stdout: 'code-review-graph:\n  Scope: Local config (private to you in this project)\n  Status: connected' };
const GLOBAL_GET = { stdout: 'code-review-graph:\n  Scope: User config (available in all your projects)' };
const MCP_ABSENT = { ok: false, code: 1, stderr: 'No MCP server named "code-review-graph" in local scope' };
const WATCH_ABSENT = { ok: false, code: 1, stderr: "No repository matching 'C:\\work\\alpha' found in config." };

/** Records every call; `script` returns the scripted result for a call (default: success). */
function fake(script: (call: Call) => Partial<CodeGraphRunResult> = () => ({})) {
  const calls: Call[] = [];
  const run: CodeGraphRunner = (file, args, options) => {
    const call = { file, args, options };
    calls.push(call);
    return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', ...script(call) });
  };
  return { calls, run };
}

const project = { folder: 'C:\\work\\alpha' };
const line = (c: Call) => [c.file, ...c.args].join(' ');
const isGet = (c: Call) => c.args[1] === 'get';
const isRemove = (c: Call) => c.args[0] === 'mcp' && c.args[1] === 'remove';
const isDaemon = (c: Call) => c.args[0] === 'daemon';

test('the server spec is exactly the agreed JSON', () => {
  assert.deepEqual(JSON.parse(CODE_GRAPH_SERVER_SPEC), {
    type: 'stdio',
    command: 'code-review-graph',
    args: ['serve'],
    env: {
      CRG_OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1',
      CRG_OPENAI_API_KEY: 'ollama',
      CRG_OPENAI_MODEL: 'qwen3-embedding-ctx2048:4b',
      CRG_OPENAI_DIMENSION: '512',
    },
  });
});

test("spawn options: no shell, hidden window, a timeout, and the session's Claude variables dropped", () => {
  const options = codeGraphSpawnOptions('C:\\x', { PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', KEEP: 'k' });
  assert.ok(!('shell' in options));
  assert.equal(options.windowsHide, true);
  assert.equal(options.timeout, CODE_GRAPH_TIMEOUT_MS);
  assert.equal(options.cwd, 'C:\\x');
  assert.equal(options.env.CLAUDECODE, undefined);
  assert.equal(options.env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(options.env.KEEP, 'k');
  assert.ok(!('cwd' in codeGraphSpawnOptions()));
});

test('enable adds the local tool connection in the project folder and the watch-list entry', async () => {
  const { calls, run } = fake((c) => (isGet(c) ? { ok: false, code: 1, stderr: 'No MCP server found' } : {}));
  assert.equal((await enableCodeGraph(project, run)).ok, true);
  const add = calls.find((c) => c.args[1] === 'add-json');
  assert.ok(add);
  assert.deepEqual(add.args, ['mcp', 'add-json', 'code-review-graph', CODE_GRAPH_SERVER_SPEC, '-s', 'local']);
  assert.equal(add.file, 'claude');
  assert.equal(add.options.cwd, project.folder);
  const daemon = calls.find((c) => c.file === 'code-review-graph' && isDaemon(c));
  assert.ok(daemon);
  assert.deepEqual(daemon.args, ['daemon', 'add', project.folder]);
});

test('enable twice is safe: add-json is skipped when the connection already exists locally', async () => {
  const { calls, run } = fake((c) => (isGet(c) ? LOCAL_GET : {}));
  assert.equal((await enableCodeGraph(project, run)).ok, true);
  assert.equal(calls.find(isGet)?.options.cwd, project.folder);
  assert.ok(!calls.some((c) => c.args[1] === 'add-json'));
  assert.ok(calls.some((c) => isDaemon(c) && c.args[1] === 'add'));
});

test('a connection that exists only in another scope does not skip add-json', async () => {
  const { calls, run } = fake((c) => (isGet(c) ? GLOBAL_GET : {}));
  assert.equal((await enableCodeGraph(project, run)).ok, true);
  assert.ok(calls.some((c) => c.args[1] === 'add-json'));
});

test('disable removes the local connection and the watch-list entry', async () => {
  const { calls, run } = fake();
  assert.equal((await disableCodeGraph(project, run)).ok, true);
  const remove = calls.find(isRemove);
  assert.ok(remove);
  assert.deepEqual(remove.args, ['mcp', 'remove', 'code-review-graph', '-s', 'local']);
  assert.equal(remove.options.cwd, project.folder);
  assert.ok(calls.some((c) => line(c) === `code-review-graph daemon remove ${project.folder}`));
});

test('disable treats the real "not found" wording of each command as success', async () => {
  assert.equal((await disableCodeGraph(project, fake((c) => (isRemove(c) ? MCP_ABSENT : {})).run)).ok, true);
  assert.equal((await disableCodeGraph(project, fake((c) => (isDaemon(c) ? WATCH_ABSENT : {})).run)).ok, true);
});

test('disable does not treat a crash that merely says "No such file" as not found', async () => {
  const crash = { ok: false, code: 1, stderr: 'FileNotFoundError: [Errno 2] No such file or directory' };
  assert.equal((await disableCodeGraph(project, fake((c) => (isDaemon(c) ? crash : {})).run)).ok, false);
  assert.equal((await disableCodeGraph(project, fake((c) => (isRemove(c) ? crash : {})).run)).ok, false);
  // each command's wording excuses only that command
  assert.equal((await disableCodeGraph(project, fake((c) => (isRemove(c) ? WATCH_ABSENT : {})).run)).ok, false);
  assert.equal((await disableCodeGraph(project, fake((c) => (isDaemon(c) ? MCP_ABSENT : {})).run)).ok, false);
});

test('disable reports a real failure', async () => {
  const result = await disableCodeGraph(project, fake((c) => (isRemove(c) ? { ok: false, code: 2, stderr: 'boom' } : {})).run);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /boom/);
});

test('enable: when the watch-list step fails after the connection was added, the error says so', async () => {
  const { run } = fake((c) => (isGet(c) ? { ok: false, code: 1 } : isDaemon(c) ? { ok: false, code: 1, stderr: 'daemon down' } : {}));
  const result = await enableCodeGraph(project, run);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /daemon down/);
  assert.match(String(result.error), /tool connection was already added/);
  assert.match(String(result.error), /same command again finishes it/);
});

test('disable: when the watch-list removal fails after the connection was removed, the error says so', async () => {
  const result = await disableCodeGraph(project, fake((c) => (isDaemon(c) ? { ok: false, code: 1, stderr: 'daemon down' } : {})).run);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /already removed/);
  assert.match(String(result.error), /same command again finishes it/);
});

test('every spawn hides its window, has a timeout and uses no shell', async () => {
  const a = fake((c) => (isGet(c) ? { ok: false, code: 1 } : {}));
  await enableCodeGraph(project, a.run);
  const b = fake();
  await disableCodeGraph(project, b.run);
  const all = [...a.calls, ...b.calls];
  assert.ok(all.length >= 6);
  for (const c of all) {
    assert.equal(c.options.windowsHide, true, line(c));
    assert.ok(c.options.timeout > 0, line(c));
    assert.ok(!('shell' in c.options), line(c));
  }
});

test('enable with the tool not installed returns a clear error and changes nothing', async () => {
  const { calls, run } = fake((c) => (c.file === 'code-review-graph' && c.args[0] === '--version' ? { ok: false, code: null, stderr: 'spawn ENOENT' } : {}));
  const result = await enableCodeGraph(project, run);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /code-review-graph is not installed/);
  assert.deepEqual(calls.map(line), ['code-review-graph --version']);
});
