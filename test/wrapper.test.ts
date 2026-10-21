import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ownsWrapper, readPidFile } from '../src/launch/runner.ts';
import {
  buildWrapperScript,
  decodeCommand,
  encodeCommand,
  isWrapperProcess,
  jobSnippet,
  psQuote,
  sessionFiles,
  sessionStateDir,
  wrapperMarker,
  type WrapperSpec,
} from '../src/launch/wrapper.ts';
import { tempDir } from './helpers.ts';

const spec: WrapperSpec = {
  sessionId: 7,
  rosterDb: 'C:\\Users\\me\\.claude\\multi-manager\\roster.db',
  stateDir: 'C:\\Users\\me\\.claude\\multi-manager\\sessions',
  folder: 'I:\\Dropbox (Personal)\\Projects\\it\'s here',
  claudeArgs: ['-n', 'mm-alpha-main', '--settings', 'C:\\x\\7.settings.json', "Don't stop; go"],
};

test('state files live next to the roster, named by session id', () => {
  const dir = sessionStateDir('C:\\r\\roster.db');
  assert.equal(dir, join('C:\\r', 'sessions'));
  assert.deepEqual(sessionFiles(dir, 7), {
    settings: join(dir, '7.settings.json'),
    wrapperPid: join(dir, '7.wrapper.pid'),
    exit: join(dir, '7.exit'),
  });
});

test('the wrapper script: marker first, pid, job, env strip, claude, exit file', () => {
  const script = buildWrapperScript(spec);
  const lines = script.split('\n');
  assert.equal(lines[0], wrapperMarker(7, spec.rosterDb));
  const at = (needle: string) => script.indexOf(needle);
  const order = ['7.wrapper.pid', '[MmKillOnCloseJob]::Enable(0)', "-ne 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'", 'Set-Location', '& claude ', '7.exit'];
  for (const needle of order) assert.ok(at(needle) > 0, needle);
  assert.deepEqual([...order].sort((a, b) => at(a) - at(b)), order);
  assert.ok(script.includes("Set-Location -LiteralPath 'I:\\Dropbox (Personal)\\Projects\\it''s here'"));
  assert.ok(script.includes("& claude '-n' 'mm-alpha-main' '--settings' 'C:\\x\\7.settings.json' 'Don''t stop; go'"));
  assert.ok(script.includes('0x2000'));
});

test('the job snippet sets a process cap only when asked', () => {
  assert.match(jobSnippet(), /::Enable\(0\)/);
  assert.match(jobSnippet(12), /::Enable\(12\)/);
  assert.throws(() => jobSnippet(-1), /Invalid process cap/);
  assert.throws(() => jobSnippet(1.5), /Invalid process cap/);
});

test('psQuote doubles single quotes', () => {
  assert.equal(psQuote("a'b"), "'a''b'");
});

test('encodeCommand is base64 of UTF-16LE and round-trips', () => {
  assert.equal(encodeCommand('hi'), Buffer.from('h\0i\0', 'latin1').toString('base64'));
  const script = buildWrapperScript(spec);
  assert.equal(decodeCommand(encodeCommand(script)), script);
});

test('isWrapperProcess needs pwsh.exe and this exact session marker', () => {
  const marker = wrapperMarker(7, spec.rosterDb);
  const encoded = encodeCommand(buildWrapperScript(spec));
  const commandLine = `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  assert.equal(isWrapperProcess({ name: 'pwsh.exe', commandLine }, marker), true);
  assert.equal(isWrapperProcess({ name: 'pwsh.exe', commandLine: commandLine.replace(encoded, `"${encoded}"`) }, marker), true);
  assert.equal(isWrapperProcess({ name: 'node.exe', commandLine }, marker), false);
  assert.equal(isWrapperProcess({ name: 'pwsh.exe', commandLine }, wrapperMarker(8, spec.rosterDb)), false);
  assert.equal(isWrapperProcess({ name: 'pwsh.exe', commandLine }, wrapperMarker(7, 'D:\\other\\roster.db')), false);
  assert.equal(isWrapperProcess({ name: 'pwsh.exe', commandLine: 'pwsh -NoProfile' }, marker), false);
  assert.equal(isWrapperProcess({ name: 'pwsh.exe', commandLine: `pwsh -EncodedCommand ${encodeCommand(`# x\n${marker}`)}` }, marker), false);
  assert.equal(isWrapperProcess(null, marker), false);
});

const hasPwsh = process.platform === 'win32' && spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0;

test('the wrapper script parses in pwsh', { skip: !hasPwsh && 'pwsh not available' }, () => {
  const check = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:MM_TEST_SCRIPT)), [ref]$null, [ref]$e); $e.Count`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', check], {
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, MM_TEST_SCRIPT: encodeCommand(buildWrapperScript({ ...spec, maxProcesses: 50 })) },
  });
  assert.equal(result.stdout.trim(), '0', result.stderr);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitFor<T>(read: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null || Date.now() >= deadline) return value;
    await delay(100);
  }
}

function runWrapper(script: string, env: NodeJS.ProcessEnv = process.env) {
  return spawn('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeCommand(script)], {
    windowsHide: true,
    stdio: 'ignore',
    env,
  });
}

test('the real wrapper records its pid and exit code and strips Claude variables', { skip: !hasPwsh && 'pwsh not available', timeout: 60_000 }, async (t) => {
  const dir = tempDir(t);
  const rosterDb = join(dir, 'roster.db');
  const stateDir = sessionStateDir(rosterDb);
  const envOut = join(dir, 'env.json');
  const probe = `const k=Object.keys(process.env);require('fs').writeFileSync(${JSON.stringify(envOut)},JSON.stringify({cwd:process.cwd(),k}));process.exit(3)`;
  const script = buildWrapperScript({ sessionId: 41, rosterDb, stateDir, folder: dir, claudeArgs: ['-e', probe], program: process.execPath });
  const child = runWrapper(script, {
    ...process.env,
    CLAUDECODE: '1',
    CLAUDE_PID: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    MM_KEEP: '1',
  });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  assert.equal(code, 3);
  const files = sessionFiles(stateDir, 41);
  assert.equal(readPidFile(files.wrapperPid), child.pid);
  const exit = JSON.parse(readFileSync(files.exit, 'utf8')) as { code: number; at: string };
  assert.equal(exit.code, 3);
  assert.ok(!Number.isNaN(Date.parse(exit.at)));
  const seen = JSON.parse(readFileSync(envOut, 'utf8')) as { cwd: string; k: string[] };
  assert.equal(seen.cwd.toLowerCase(), dir.toLowerCase());
  const keys = new Set(seen.k.map((k) => k.toUpperCase()));
  for (const gone of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_CHILD_SESSION']) assert.ok(!keys.has(gone), gone);
  assert.ok(keys.has('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'));
  assert.ok(keys.has('MM_KEEP'));
});

test('killing the wrapper kills what it started (kill-on-close Job); ownership is checked for real', { skip: !hasPwsh && 'pwsh not available', timeout: 90_000 }, async (t) => {
  const dir = tempDir(t);
  const rosterDb = join(dir, 'roster.db');
  const stateDir = sessionStateDir(rosterDb);
  const childPidFile = join(dir, 'child.pid');
  const sleeper = `require('fs').writeFileSync(${JSON.stringify(childPidFile)},String(process.pid));setTimeout(()=>{},60000)`;
  const script = buildWrapperScript({ sessionId: 42, rosterDb, stateDir, folder: dir, claudeArgs: ['-e', sleeper], program: process.execPath });
  const wrapper = runWrapper(script);
  let sleeperPid: number | null = null;
  t.after(() => {
    // Only ever the processes this test started.
    if (wrapper.exitCode === null) wrapper.kill();
    if (sleeperPid !== null && isAlive(sleeperPid)) process.kill(sleeperPid);
  });
  sleeperPid = await waitFor(() => readPidFile(childPidFile), 45_000);
  assert.notEqual(sleeperPid, null, 'the sleeping child never started');
  assert.equal(readPidFile(sessionFiles(stateDir, 42).wrapperPid), wrapper.pid);
  assert.equal(await ownsWrapper(wrapper.pid ?? 0, wrapperMarker(42, rosterDb)), true);
  assert.equal(await ownsWrapper(wrapper.pid ?? 0, wrapperMarker(43, rosterDb)), false);
  assert.equal(await ownsWrapper(process.pid, wrapperMarker(42, rosterDb)), false);

  // TerminateProcess on the pwsh alone, not a tree kill: only the Job can take the child down.
  wrapper.kill();
  const pid = sleeperPid ?? 0;
  const gone = await waitFor(() => (isAlive(pid) ? null : true), 5_000);
  assert.equal(gone, true, `child ${pid} outlived its wrapper`);
  assert.ok(!existsSync(sessionFiles(stateDir, 42).exit), 'a killed wrapper writes no exit file');
});

test('wrapperMarker matches across slash style and case, but not across sessions', () => {
  const marker = wrapperMarker(2, 'C:/Users/Me/Temp/mm/roster.db');
  assert.equal(wrapperMarker(2, String.raw`c:\users\me\temp\mm\roster.db`), marker);
  assert.notEqual(wrapperMarker(3, 'C:/Users/Me/Temp/mm/roster.db'), marker);
});
