import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  claudePids,
  findLivePid,
  hidesWindow,
  launchEnv,
  ownsProcess,
  readPidFile,
  removeFiles,
  runCommand,
  waitForPid,
  waitForPidFile,
  writeSettingsFile,
} from '../src/launch/runner.ts';
import { tempDir } from './helpers.ts';

test('runCommand returns exit code and output', async () => {
  const result = await runCommand({
    file: process.execPath,
    args: ['-e', 'process.stdout.write("hi"); process.stderr.write("oops"); process.exit(3)'],
  });
  assert.deepEqual(result, { code: 3, stdout: 'hi', stderr: 'oops' });
});

test('runCommand reports a missing program instead of throwing', async () => {
  const result = await runCommand({ file: 'mm-no-such-program-xyz', args: [] });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /ENOENT/);
});

test('waitForPid polls until the session file appears', async (t) => {
  const dir = tempDir(t);
  setTimeout(() => writeFileSync(join(dir, '77.json'), JSON.stringify({ pid: 77, name: 'mm-a-main', startedAt: Date.now() })), 150);
  assert.equal(await waitForPid('mm-a-main', Date.now() - 1000, { dir, timeoutMs: 3000, intervalMs: 50, livePids: async () => new Set([77]) }), 77);
});

test('waitForPid gives up after the timeout', async (t) => {
  assert.equal(await waitForPid('nobody', 0, { dir: tempDir(t), timeoutMs: 200, intervalMs: 50, livePids: async () => new Set() }), null);
});

test('findLivePid skips stale session files whose claude.exe is gone', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, '77.json'), JSON.stringify({ pid: 77, name: 'mm-a-main', startedAt: 2000 }));
  writeFileSync(join(dir, '78.json'), JSON.stringify({ pid: 78, name: 'mm-a-main', startedAt: 1000 }));
  assert.equal(await findLivePid('mm-a-main', { dir, livePids: async () => new Set([78]) }), 78);
  assert.equal(await findLivePid('mm-a-main', { dir, livePids: async () => new Set() }), null);
});

test('real claude.exe lookup never returns this node process', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'mm-a-main', startedAt: 1 }));
  assert.equal(await findLivePid('mm-a-main', { dir }), null);
  assert.equal((await claudePids()).has(process.pid), false);
});

test('readPidFile and waitForPidFile', async (t) => {
  const dir = tempDir(t);
  const path = join(dir, '7.wrapper.pid');
  assert.equal(readPidFile(path), null);
  writeFileSync(path, 'junk');
  assert.equal(readPidFile(path), null);
  setTimeout(() => writeFileSync(path, '1234\r\n'), 100);
  assert.equal(await waitForPidFile(path, { timeoutMs: 3000, intervalMs: 25 }), 1234);
  assert.equal(await waitForPidFile(join(dir, 'none'), { timeoutMs: 100, intervalMs: 25 }), null);
});

test('removeFiles deletes ours and ignores missing ones', (t) => {
  const dir = tempDir(t);
  const path = join(dir, '7.exit');
  writeFileSync(path, '{}');
  removeFiles([path, join(dir, 'missing.pid')]);
  assert.ok(!existsSync(path));
});

test('writeSettingsFile creates its folder', (t) => {
  const path = join(tempDir(t), 'sessions', '7.settings.json');
  writeSettingsFile({ path, content: '{"env":{}}\n' });
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), '{"env":{}}\n');
});

test('ownsProcess refuses a name mismatch and a non-claude image', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'mm-a-main' }));
  assert.equal(await ownsProcess(process.pid, 'mm-other', dir), false);
  assert.equal(await ownsProcess(process.pid, 'mm-a-main', dir), false); // image is node.exe, not claude.exe
});

test('launchEnv drops the calling Claude session variables but keeps the rest', () => {
  const env = launchEnv({
    PATH: 'x',
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_MESSAGING_SOCKET: 'pipe',
    CLAUDE_PID: '3260',
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    MM_ROLE: 'architect',
  });
  assert.deepEqual(env, { PATH: 'x', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', MM_ROLE: 'architect' });
});

test('hidesWindow is false only for wt.exe', () => {
  assert.equal(hidesWindow(String.raw`C:\Users\me\AppData\Local\Microsoft\WindowsApps\wt.exe`), false);
  assert.equal(hidesWindow('wt.exe'), false);
  assert.equal(hidesWindow('taskkill'), true);
  assert.equal(hidesWindow('tasklist'), true);
});
