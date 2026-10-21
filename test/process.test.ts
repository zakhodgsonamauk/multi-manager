import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findSessionPid, parseProcessInfo, parseTasklistImage, parseTasklistPids, readSessionFile } from '../src/launch/process.ts';
import { tempDir } from './helpers.ts';

function writeSession(dir: string, pid: number, fields: Record<string, unknown>): void {
  writeFileSync(join(dir, `${pid}.json`), JSON.stringify({ pid, kind: 'interactive', ...fields }));
}

test('finds the newest session file with the given name', (t) => {
  const dir = tempDir(t);
  writeSession(dir, 100, { name: 'mm-alpha-main', startedAt: 1000 });
  writeSession(dir, 200, { name: 'mm-alpha-main', startedAt: 3000 });
  writeSession(dir, 300, { name: 'mm-beta-main', startedAt: 4000 });
  writeFileSync(join(dir, '400.json'), '{not json');
  writeFileSync(join(dir, '200.7b76.key'), 'x');
  assert.equal(findSessionPid('mm-alpha-main', { dir }), 200);
  assert.equal(findSessionPid('mm-alpha-main', { dir, since: 3500 }), null);
  assert.equal(findSessionPid('mm-gamma-main', { dir }), null);
});

test('a missing sessions folder means no pid', (t) => {
  assert.equal(findSessionPid('mm-alpha-main', { dir: join(tempDir(t), 'missing') }), null);
});

test('readSessionFile reads <pid>.json or returns null', (t) => {
  const dir = tempDir(t);
  writeSession(dir, 77, { name: 'mm-alpha-main', startedAt: 1 });
  assert.equal(readSessionFile(77, dir)?.name, 'mm-alpha-main');
  assert.equal(readSessionFile(78, dir), null);
});

test('isLive filters out stale session files', (t) => {
  const dir = tempDir(t);
  writeSession(dir, 100, { name: 'mm-alpha-main', startedAt: 1000 });
  writeSession(dir, 200, { name: 'mm-alpha-main', startedAt: 3000 });
  assert.equal(findSessionPid('mm-alpha-main', { dir, isLive: (pid) => pid === 100 }), 100);
  assert.equal(findSessionPid('mm-alpha-main', { dir, isLive: () => false }), null);
});

test('parseTasklistPids reads every pid', () => {
  const csv = '"claude.exe","4242","Console","1","301,512 K"\r\n"claude.exe","5151","Console","1","1 K"\r\n';
  assert.deepEqual([...parseTasklistPids(csv)], [4242, 5151]);
  assert.equal(parseTasklistPids('INFO: No tasks are running which match the specified criteria.\r\n').size, 0);
});

test('parseProcessInfo reads CIM JSON', () => {
  assert.deepEqual(parseProcessInfo('{"Name":"pwsh.exe","CommandLine":"pwsh -NoProfile"}'), { name: 'pwsh.exe', commandLine: 'pwsh -NoProfile' });
  assert.deepEqual(parseProcessInfo('{"Name":"System","CommandLine":null}'), { name: 'System', commandLine: '' });
  assert.equal(parseProcessInfo(''), null);
  assert.equal(parseProcessInfo('null'), null);
});

test('parseTasklistImage reads the image name from tasklist CSV', () => {
  assert.equal(parseTasklistImage('"claude.exe","4242","Console","1","301,512 K"\r\n'), 'claude.exe');
  assert.equal(parseTasklistImage('INFO: No tasks are running which match the specified criteria.\r\n'), null);
});
