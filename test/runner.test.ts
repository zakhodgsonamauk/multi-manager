import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ownsProcess, runCommand, waitForPid, writeSettingsFile } from '../src/launch/runner.ts';
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
  assert.equal(await waitForPid('mm-a-main', Date.now() - 1000, { dir, timeoutMs: 3000, intervalMs: 50 }), 77);
});

test('waitForPid gives up after the timeout', async (t) => {
  assert.equal(await waitForPid('nobody', 0, { dir: tempDir(t), timeoutMs: 200, intervalMs: 50 }), null);
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
