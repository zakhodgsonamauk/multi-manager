import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ensureWatcher,
  pruneStaleGraphData,
  releaseWatcher,
  type CodeGraphRunOptions,
  type CodeGraphRunResult,
  type GraphFs,
  type WatcherDeps,
} from '../src/codegraph/codegraph.ts';
import { parseProcessList } from '../src/launch/process.ts';

const project = { folder: 'C:\\work\\alpha' };
const RUNNING = 'Daemon:  running\nName:    crg-watch\n';
const STOPPED = 'Daemon:  not running\nName:    crg-watch\n';
const EMPTY_LIST = `${STOPPED}\n  Alias             Path\n  ----------------  ----------------------------------------\n`;
const ONE_LEFT = `${EMPTY_LIST}  other             C:\\work\\other\n`;

function fake(status: string, processes: { pid: number; commandLine: string }[] = []) {
  const ran: string[] = [];
  const spawned: { file: string; args: string[]; options: CodeGraphRunOptions }[] = [];
  const killed: number[] = [];
  const logs: string[] = [];
  const deps: WatcherDeps = {
    runner: (file, args) => {
      ran.push([file, ...args].join(' '));
      const out: Partial<CodeGraphRunResult> = args[1] === 'status' ? { stdout: status } : {};
      return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', ...out });
    },
    spawnDetached: (file, args, options) => {
      spawned.push({ file, args, options });
    },
    listProcesses: () => Promise.resolve(processes),
    killPid: (pid) => {
      killed.push(pid);
      return Promise.resolve(true);
    },
    log: (line) => logs.push(line),
  };
  return { deps, ran, spawned, killed, logs };
}

test('ensureWatcher adds the folder and starts the daemon, detached and hidden, when it is not running', async () => {
  const f = fake(STOPPED);
  assert.equal((await ensureWatcher(project, f.deps)).ok, true);
  assert.deepEqual(f.ran, ['code-review-graph daemon add C:\\work\\alpha', 'code-review-graph daemon status']);
  assert.equal(f.spawned.length, 1);
  assert.deepEqual([f.spawned[0].file, ...f.spawned[0].args], ['code-review-graph', 'daemon', 'start']);
  assert.equal(f.spawned[0].options.windowsHide, true);
});

test('ensureWatcher does not start the daemon when it already runs', async () => {
  const f = fake(RUNNING);
  await ensureWatcher(project, f.deps);
  assert.equal(f.spawned.length, 0);
});

test('releaseWatcher does nothing while another architect or project manager runs', async () => {
  const f = fake(EMPTY_LIST);
  await releaseWatcher(project, true, f.deps);
  assert.deepEqual(f.ran, []);
});

test('releaseWatcher removes the folder but leaves the daemon while other folders are watched', async () => {
  const f = fake(ONE_LEFT, [{ pid: 9, commandLine: 'code-review-graph watch --repo C:\\work\\other' }]);
  await releaseWatcher(project, false, f.deps);
  assert.deepEqual(f.ran, ['code-review-graph daemon remove C:\\work\\alpha', 'code-review-graph daemon status']);
  assert.deepEqual(f.killed, []);
});

test('releaseWatcher with an empty list stops the daemon and closes only watcher programs, by pid', async () => {
  const f = fake(EMPTY_LIST, [
    { pid: 11, commandLine: '"C:\\py\\python.exe" "C:\\py\\Scripts\\code-review-graph.exe" watch --repo "C:\\work\\alpha"' },
    { pid: 12, commandLine: 'code-review-graph serve' },
    { pid: 13, commandLine: 'notepad.exe watch --repo x' },
    { pid: 14, commandLine: 'code-review-graph.exe watch --repo C:\\work\\beta' },
  ]);
  await releaseWatcher(project, false, f.deps);
  assert.ok(f.ran.includes('code-review-graph daemon stop'));
  assert.deepEqual(f.killed, [11, 14]);
});

test('releaseWatcher logs a failing command and does not throw', async () => {
  const f = fake(EMPTY_LIST);
  f.deps.runner = () => Promise.resolve({ ok: false, code: 2, stdout: '', stderr: 'boom' });
  const result = await releaseWatcher(project, false, f.deps);
  assert.equal(result.ok, false);
  assert.match(f.logs[0], /boom/);
});

test('parseProcessList reads one object, an array, or junk', () => {
  assert.deepEqual(parseProcessList('{"ProcessId":5,"CommandLine":"x"}'), [{ pid: 5, commandLine: 'x' }]);
  assert.deepEqual(parseProcessList('[{"ProcessId":5,"CommandLine":null},{"ProcessId":"a"}]'), [{ pid: 5, commandLine: '' }]);
  assert.deepEqual(parseProcessList('nope'), []);
  assert.deepEqual(parseProcessList(''), []);
});

function prune(t: { after: (fn: () => void) => void }, repos: object[]) {
  const dir = mkdtempSync(join(tmpdir(), 'crg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'graphs');
  mkdirSync(root);
  const registryPath = join(dir, 'registry.json');
  writeFileSync(registryPath, JSON.stringify({ repos }));
  const logs: string[] = [];
  const renames: string[] = [];
  const fs: GraphFs = {
    registryPath,
    dataRoot: root,
    exists: existsSync,
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, c) => {
      writeFileSync(p, c);
    },
    rename: (a, b) => {
      renames.push(`${a}->${b}`);
      renameSync(a, b);
    },
    removeDir: (p) => {
      rmSync(p, { recursive: true, force: true });
    },
    log: (l) => logs.push(l),
  };
  return { dir, root, fs, logs, renames, registryPath };
}

test('pruneStaleGraphData removes stale entries and their index folders inside the data root, keeps the rest', (t) => {
  const p = prune(t, []);
  const live = join(p.dir, 'live');
  mkdirSync(live);
  const staleData = join(p.root, 'gone-1');
  const keepData = join(p.root, 'live-1');
  const outside = join(p.dir, 'elsewhere');
  mkdirSync(staleData);
  mkdirSync(keepData);
  mkdirSync(outside);
  const repos = [
    { path: join(p.dir, 'gone'), data_dir: staleData, alias: 'gone' },
    { path: live, data_dir: keepData, alias: 'live' },
    { path: join(p.dir, 'gone2'), data_dir: outside, alias: 'gone2' },
  ];
  writeFileSync(p.registryPath, JSON.stringify({ repos }));
  assert.deepEqual(pruneStaleGraphData(p.fs), { removed: 2 });
  assert.deepEqual((JSON.parse(readFileSync(p.registryPath, 'utf8')) as { repos: object[] }).repos, [repos[1]]);
  assert.equal(existsSync(staleData), false);
  assert.equal(existsSync(keepData), true);
  assert.equal(existsSync(outside), true);
  assert.equal(p.logs.length, 1);
  assert.match(p.logs[0], /outside/);
  assert.deepEqual(p.renames, [`${p.registryPath}.tmp->${p.registryPath}`]);
  assert.equal(existsSync(`${p.registryPath}.tmp`), false);
});

test('pruneStaleGraphData never deletes the data root itself or a lookalike sibling', (t) => {
  const p = prune(t, []);
  const sibling = `${p.root}-x`;
  mkdirSync(sibling);
  writeFileSync(p.registryPath, JSON.stringify({ repos: [{ path: join(p.dir, 'a'), data_dir: p.root }, { path: join(p.dir, 'b'), data_dir: sibling }] }));
  pruneStaleGraphData(p.fs);
  assert.equal(existsSync(p.root), true);
  assert.equal(existsSync(sibling), true);
  assert.equal(p.logs.length, 2);
});

test('pruneStaleGraphData leaves an all-live registry untouched and survives a broken or missing one', (t) => {
  const p = prune(t, [{ path: tmpdir(), data_dir: join(tmpdir(), 'x') }]);
  const before = readFileSync(p.registryPath, 'utf8');
  assert.deepEqual(pruneStaleGraphData(p.fs), { removed: 0 });
  assert.equal(readFileSync(p.registryPath, 'utf8'), before);
  assert.deepEqual(p.renames, []);
  writeFileSync(p.registryPath, '{not json');
  assert.deepEqual(pruneStaleGraphData(p.fs), { removed: 0 });
  rmSync(p.registryPath);
  assert.deepEqual(pruneStaleGraphData(p.fs), { removed: 0 });
});

test('pruneStaleGraphData keeps an entry whose folder and parent are both missing (drive offline) and logs it', (t) => {
  const p = prune(t, []);
  const data = join(p.root, 'offline-1');
  mkdirSync(data);
  const repos = [{ path: join(p.dir, 'unmounted', 'proj'), data_dir: data, alias: 'proj' }];
  writeFileSync(p.registryPath, JSON.stringify({ repos }));
  const before = readFileSync(p.registryPath, 'utf8');
  assert.deepEqual(pruneStaleGraphData(p.fs), { removed: 0 });
  assert.equal(readFileSync(p.registryPath, 'utf8'), before);
  assert.equal(existsSync(data), true);
  assert.equal(p.logs.length, 1);
  assert.match(p.logs[0], /drive offline/);
});
