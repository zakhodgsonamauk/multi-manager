import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import {
  clusterDbPath,
  ensureClusterDir,
  FRONT_DESK_CLEARED_VARS,
  frontDeskCommand,
  frontDeskEnv,
  INHERITED_CLAUDE_VARS,
  INHERITED_MM_VARS,
  runFrontDeskLaunch,
  type FrontDeskSpawn,
} from '../src/launch/front-desk-launch.ts';
import { decodeCommand, PWSH_ARGS, psQuote } from '../src/launch/wrapper.ts';
import { resolveDbPath } from '../src/roster/db.ts';

const FOLDER = 'I:\\Dropbox (Personal)\\Projects\\alpha team';
const PLUGIN = 'I:\\Dropbox (Personal)\\Projects\\multi-manager';

const temps: string[] = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-fd-'));
  temps.push(dir);
  return dir;
}

function launch(remote: boolean, cluster: string | null = FOLDER) {
  const cmd = frontDeskCommand({ cluster, pluginDir: PLUGIN, wtPath: 'wt.exe', remote });
  const at = cmd.args.indexOf('pwsh');
  assert.ok(at > 0, 'the tab runs pwsh');
  assert.deepEqual(cmd.args.slice(at + 1, at + 1 + PWSH_ARGS.length), [...PWSH_ARGS]);
  assert.equal(cmd.args.length, at + PWSH_ARGS.length + 2, 'the encoded script is the last argument');
  return { ...cmd, script: decodeCommand(cmd.args[cmd.args.length - 1]) };
}

/** The line that runs claude, split into its single-quoted arguments. */
function claudeArgs(script: string): string[] {
  const line = script.split('\n').find((l) => l.startsWith('& claude '));
  assert.ok(line, 'the script runs claude');
  return [...line.slice('& claude '.length).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

test('clusterDbPath nests the roster inside the cluster folder', () => {
  assert.equal(clusterDbPath('C:\\work\\alpha'), 'C:\\work\\alpha\\.multi-manager\\roster.db');
});

test('the tab opens a new Terminal window in the chosen folder', () => {
  const { file, args } = launch(false);
  assert.equal(file, 'wt.exe');
  assert.deepEqual(args.slice(0, args.indexOf('pwsh')), ['-w', 'new', 'new-tab', '--title', 'mm-front-desk', '-d', FOLDER]);
});

test('the tab script sets the cluster roster itself, not through the wt.exe environment', () => {
  const { script, rosterDb } = launch(false);
  assert.equal(rosterDb, `${FOLDER}\\.multi-manager\\roster.db`);
  assert.ok(script.includes(`$env:MM_ROSTER_DB = ${psQuote(rosterDb)}`), script);
});

test('the tab script sets CLAUDE_CODE_NO_FLICKER=1 so the side pane can dock', () => {
  assert.ok(launch(false).script.includes(`$env:CLAUDE_CODE_NO_FLICKER = '1'`));
});

test('the tab script removes every inherited Claude Code and session-identity variable before running claude', () => {
  const { script } = launch(false);
  assert.deepEqual([...INHERITED_CLAUDE_VARS], [
    'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID',
  ]);
  assert.deepEqual([...INHERITED_MM_VARS], ['MM_ROLE', 'MM_SESSION_ID', 'MM_PARENT_ID', 'MM_VOICE']);
  const removeLine = script.split('\n').find((l) => l.includes('Remove-Item'));
  assert.ok(removeLine, 'a line removes variables');
  for (const name of [...INHERITED_CLAUDE_VARS, ...INHERITED_MM_VARS, 'MM_ROSTER_DB']) {
    assert.ok(removeLine.includes(psQuote(name)), `removes ${name}`);
  }
  const lines = script.split('\n');
  const runAt = lines.findIndex((l) => l.startsWith('& claude '));
  assert.ok(lines.indexOf(removeLine) < runAt, 'removed before claude runs');
  assert.ok(lines.indexOf(removeLine) < lines.findIndex((l) => l.startsWith('$env:MM_ROSTER_DB')), 'removed before the roster is set');
  assert.ok(lines.findIndex((l) => l.startsWith('$env:CLAUDE_CODE_NO_FLICKER')) < runAt);
  assert.ok(lines.findIndex((l) => l.startsWith('$env:MM_ROSTER_DB')) < runAt);
});

test('the tab script runs claude as the front desk with the plugin and no permission prompts', () => {
  const { script } = launch(false);
  assert.ok(script.includes(`Set-Location -LiteralPath ${psQuote(FOLDER)}`));
  assert.deepEqual(claudeArgs(script), [
    '-n', 'mm-front-desk', '--plugin-dir', PLUGIN, '--dangerously-skip-permissions', '/multi-manager:front-desk',
  ]);
});

test('remote control adds --remote-control mm-front-desk only when ticked', () => {
  const args = claudeArgs(launch(true).script);
  assert.equal(args[args.indexOf('--remote-control') + 1], 'mm-front-desk');
  assert.ok(!claudeArgs(launch(false).script).includes('--remote-control'));
});

test('the main team (no cluster folder) opens in the plugin folder and sets no MM_ROSTER_DB', () => {
  const { args, script, rosterDb } = launch(true, null);
  assert.equal(rosterDb, null);
  assert.equal(args[args.indexOf('-d') + 1], PLUGIN);
  assert.ok(script.includes(`Set-Location -LiteralPath ${psQuote(PLUGIN)}`));
  assert.ok(!script.includes('$env:MM_ROSTER_DB ='), 'no roster is set: the global one is used');
  const removeLine = script.split('\n').find((l) => l.includes('Remove-Item'));
  assert.ok(removeLine?.includes(psQuote('MM_ROSTER_DB')), 'an inherited cluster roster is cleared');
  for (const name of [...INHERITED_CLAUDE_VARS, ...INHERITED_MM_VARS]) assert.ok(removeLine?.includes(psQuote(name)));
  assert.ok(script.includes(`$env:CLAUDE_CODE_NO_FLICKER = '1'`));
  assert.deepEqual(claudeArgs(script), [
    '-n', 'mm-front-desk', '--remote-control', 'mm-front-desk', '--plugin-dir', PLUGIN,
    '--dangerously-skip-permissions', '/multi-manager:front-desk',
  ]);
});

test('paths with spaces, parentheses, quotes and semicolons survive', () => {
  const odd = "C:\\it's (odd); folder";
  const { args, script, rosterDb } = launch(false, odd);
  assert.equal(args[args.indexOf('-d') + 1], "C:\\it's (odd)\\; folder", 'wt.exe ; is escaped');
  assert.ok(script.includes(`$env:MM_ROSTER_DB = 'C:\\it''s (odd); folder\\.multi-manager\\roster.db'`));
  assert.equal(rosterDb, "C:\\it's (odd); folder\\.multi-manager\\roster.db");
  assert.ok(script.includes(`Set-Location -LiteralPath 'C:\\it''s (odd); folder'`));
});

test('a curly apostrophe in the folder is doubled so PowerShell keeps it inside the string', () => {
  const { script } = launch(false, 'C:\\Zak\u2019s folder');
  assert.ok(script.includes(`Set-Location -LiteralPath 'C:\\Zak\u2019\u2019s folder'`), script);
  assert.ok(script.includes(`$env:MM_ROSTER_DB = 'C:\\Zak\u2019\u2019s folder\\.multi-manager\\roster.db'`));
});

test('two folders yield two different roster DBs (isolation)', () => {
  const a = launch(false, 'C:\\work\\alpha');
  const b = launch(false, 'C:\\work\\beta');
  assert.ok(a.rosterDb && b.rosterDb);
  assert.notEqual(a.rosterDb, b.rosterDb);
  assert.notEqual(a.script, b.script);
  assert.equal(resolveDbPath({ MM_ROSTER_DB: a.rosterDb }), a.rosterDb);
  assert.equal(resolveDbPath({ MM_ROSTER_DB: b.rosterDb }), b.rosterDb);
});

test('frontDeskEnv drops only the inherited Claude and session-identity variables', () => {
  const env = frontDeskEnv({
    PATH: 'C:\\bin',
    CLAUDECODE: '1',
    CLAUDE_CODE_SESSION_ID: 'parent',
    CLAUDE_CODE_MESSAGING_SOCKET: 'sock',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
    claude_pid: '7',
    MM_ROLE: 'architect',
    MM_SESSION_ID: '3',
    MM_PARENT_ID: '1',
    MM_VOICE: 'off',
  });
  assert.deepEqual(env, { PATH: 'C:\\bin', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000' });
});

test('ensureClusterDir creates .multi-manager with a .gitignore of * and never touches the folder\'s own .gitignore', () => {
  const folder = tempDir();
  writeFileSync(join(folder, '.gitignore'), 'node_modules\n');
  ensureClusterDir(folder);
  assert.equal(readFileSync(join(folder, '.multi-manager', '.gitignore'), 'utf8'), '*\n');
  assert.equal(readFileSync(join(folder, '.gitignore'), 'utf8'), 'node_modules\n');
});

test('ensureClusterDir leaves an existing .multi-manager\\.gitignore alone', () => {
  const folder = tempDir();
  ensureClusterDir(folder);
  writeFileSync(join(folder, '.multi-manager', '.gitignore'), '*\n!keep\n');
  ensureClusterDir(folder);
  assert.equal(readFileSync(join(folder, '.multi-manager', '.gitignore'), 'utf8'), '*\n!keep\n');
});

// ---- the runner behind scripts/front-desk-launch.ts ----

interface SpawnCall {
  file: string;
  args: string[];
  options: Parameters<FrontDeskSpawn>[2];
}

/** A fake spawn that records its call and then plays the given events. */
function fakeSpawn(events: (child: EventEmitter) => void): { spawn: FrontDeskSpawn; calls: SpawnCall[]; unrefs: () => number } {
  const calls: SpawnCall[] = [];
  let unrefs = 0;
  const spawn: FrontDeskSpawn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = Object.assign(new EventEmitter(), { unref: () => { unrefs++; } });
    setImmediate(() => events(child));
    return child;
  };
  return { spawn, calls, unrefs: () => unrefs };
}

function run(argv: string[], spawn: FrontDeskSpawn, env: NodeJS.ProcessEnv = { PATH: 'C:\\bin', CLAUDECODE: '1', MM_ROLE: 'developer' }) {
  const errors: string[] = [];
  const code = runFrontDeskLaunch(argv, { spawn, env, wtPath: 'wt.exe', error: (m) => errors.push(m) });
  return { code, errors };
}

test('runner: a missing folder exits 1 with the reason and starts nothing', async () => {
  const fake = fakeSpawn(() => {});
  const { code, errors } = run(['--folder', join(tempDir(), 'nope'), '--plugin-dir', PLUGIN], fake.spawn);
  assert.equal(await code, 1);
  assert.match(errors.join('\n'), /The folder does not exist/);
  assert.equal(fake.calls.length, 0);
});

test('runner: spawns wt.exe detached, output ignored, with the cleaned environment, and waits for it to exit', async () => {
  const folder = tempDir();
  const fake = fakeSpawn((child) => { child.emit('spawn'); child.emit('exit', 0, null); });
  const { code, errors } = run(['--folder', folder, '--plugin-dir', PLUGIN, '--remote'], fake.spawn);
  assert.equal(await code, 0);
  assert.deepEqual(errors, []);
  assert.equal(fake.unrefs(), 0, 'the child is not unref()ed: Node must stay alive until wt.exe exits');
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.file, 'wt.exe');
  assert.deepEqual(call.args, frontDeskCommand({ cluster: folder, pluginDir: PLUGIN, wtPath: 'wt.exe', remote: true }).args);
  assert.equal(call.options.detached, true);
  assert.equal(call.options.stdio, 'ignore');
  assert.deepEqual(call.options.env, { PATH: 'C:\\bin' });
  assert.ok(existsSync(join(folder, '.multi-manager', '.gitignore')), 'the cluster folder is prepared');
});

test('runner: a spawn error exits 1 with the reason', async () => {
  const fake = fakeSpawn((child) => child.emit('error', new Error('spawn wt.exe ENOENT')));
  const { code, errors } = run(['--folder', tempDir(), '--plugin-dir', PLUGIN], fake.spawn);
  assert.equal(await code, 1);
  assert.match(errors.join('\n'), /Could not start Windows Terminal \(wt\.exe\): spawn wt\.exe ENOENT/);
});

test('runner: wt.exe exiting non-zero is a failure', async () => {
  const fake = fakeSpawn((child) => { child.emit('spawn'); child.emit('exit', 5, null); });
  const { code, errors } = run(['--folder', tempDir(), '--plugin-dir', PLUGIN], fake.spawn);
  assert.equal(await code, 1);
  assert.match(errors.join('\n'), /Windows Terminal \(wt\.exe\) exited with code 5/);
});

test('runner: --main opens the main team in the plugin folder and prepares no cluster folder', async () => {
  const fake = fakeSpawn((child) => { child.emit('spawn'); child.emit('exit', 0, null); });
  const plugin = tempDir();
  const { code } = run(['--main', '--plugin-dir', plugin], fake.spawn);
  assert.equal(await code, 0);
  assert.deepEqual(fake.calls[0].args, frontDeskCommand({ cluster: null, pluginDir: plugin, wtPath: 'wt.exe', remote: false }).args);
  assert.ok(!existsSync(join(plugin, '.multi-manager')));
});

test('runner: exactly one of --main and --folder, and --plugin-dir, are required', async () => {
  const fake = fakeSpawn(() => {});
  for (const argv of [['--plugin-dir', PLUGIN], ['--main', '--folder', 'C:\\x', '--plugin-dir', PLUGIN], ['--main']]) {
    const { code, errors } = run(argv, fake.spawn);
    assert.equal(await code, 1, argv.join(' '));
    assert.match(errors.join('\n'), /usage:/);
  }
  assert.equal(fake.calls.length, 0);
});

test('runner: a top-level-await script stays alive until a real short-lived child exits, then exits 0', () => {
  // The bug this guards: unref() on the child let Node exit 13 (unsettled top-level await) before wt.exe exited.
  // A real child stands in for wt.exe (any program works: the event loop only needs a live child handle).
  const dir = tempDir();
  const script = join(dir, 'launch.mjs');
  const runner = pathToFileURL(join(import.meta.dirname, '..', 'src', 'launch', 'front-desk-launch.ts')).href;
  writeFileSync(script, [
    `import { spawn } from 'node:child_process';`,
    `import { runFrontDeskLaunch } from ${JSON.stringify(runner)};`,
    `const standIn = (_file, _args, options) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], options);`,
    `process.exitCode = await runFrontDeskLaunch(['--main', '--plugin-dir', ${JSON.stringify(dir)}], {`,
    `  spawn: standIn, env: process.env, wtPath: 'wt.exe', error: (m) => console.error(m),`,
    `});`,
    '',
  ].join('\n'));
  const result = spawnSync(process.execPath, ['--no-warnings', script], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, `exit ${result.status}; stderr: ${result.stderr}`);
});

test('FRONT_DESK_CLEARED_VARS is the inherited set plus MM_ROSTER_DB', () => {
  assert.deepEqual([...FRONT_DESK_CLEARED_VARS], [...INHERITED_CLAUDE_VARS, ...INHERITED_MM_VARS, 'MM_ROSTER_DB']);
});
