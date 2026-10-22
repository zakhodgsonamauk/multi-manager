import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isChildOf, parseCreationDate, parseSnapshot, sessionTree, snapshotProcesses, type ProcessInfo } from '../src/monitor/processes.ts';

function proc(pid: number, ppid: number, name: string, created: number): ProcessInfo {
  return { pid, ppid, name, created, commandLine: null };
}

test('parseSnapshot reads Windows PowerShell and PowerShell 7 output', () => {
  const legacy = '[{"ProcessId":10,"ParentProcessId":4,"Name":"a.exe","CreationDate":"\\/Date(1792585443387)\\/","CommandLine":"a --x"}]';
  assert.deepEqual(parseSnapshot(legacy), [{ pid: 10, ppid: 4, name: 'a.exe', created: 1792585443387, commandLine: 'a --x' }]);
  const modern = '{"ProcessId":11,"ParentProcessId":10,"Name":"b.exe","CreationDate":"2026-10-21T13:24:03.387+01:00","CommandLine":null}';
  assert.deepEqual(parseSnapshot(modern), [{ pid: 11, ppid: 10, name: 'b.exe', created: Date.parse('2026-10-21T12:24:03.387Z'), commandLine: null }]);
  assert.deepEqual(parseSnapshot('  '), []);
  assert.ok(Number.isNaN(parseCreationDate(null)));
});

test('parseSnapshot survives a raw control character in a command line', () => {
  // Windows PowerShell 5.1 leaves some control characters unescaped, e.g. a code-page "->" that became U+001A.
  const raw = '[{"ProcessId":12,"ParentProcessId":4,"Name":"git.exe","CreationDate":null,"CommandLine":"git commit -m \\"A \u001a B\\""}]';
  assert.deepEqual(parseSnapshot(raw).map((p) => [p.pid, p.commandLine]), [[12, 'git commit -m "A \u001a B"']]);
});

test('sessionTree returns nested descendants, not the root or unrelated processes', () => {
  const snap = [
    proc(1, 0, 'wt.exe', 100),
    proc(10, 1, 'claude.exe', 200),
    proc(11, 10, 'pwsh.exe', 300),
    proc(12, 11, 'godot.exe', 400),
    proc(13, 12, 'godot.exe', 500),
    proc(20, 1, 'other.exe', 250),
  ];
  assert.deepEqual(sessionTree(snap, 10).map((p) => p.pid), [11, 12, 13]);
  assert.deepEqual(sessionTree(snap, 99), []);
  assert.deepEqual(sessionTree(snap, 10, { stopAt: new Set([12]) }).map((p) => p.pid), [11]);
});

test('sessionTree ignores a process whose parent pid was reused by a newer process', () => {
  // pid 30 was godot's parent once; that parent died and pid 30 now belongs to a newer claude.exe.
  const snap = [proc(30, 1, 'claude.exe', 1000), proc(31, 30, 'godot.exe', 500), proc(32, 30, 'node.exe', 1500)];
  assert.deepEqual(sessionTree(snap, 30).map((p) => p.pid), [32]);
  assert.equal(isChildOf(snap[1], snap[0]), false);
  assert.equal(isChildOf(proc(33, 30, 'x', 1000), snap[0]), true, 'same millisecond still counts');
});

test('a real snapshot contains this node process', async () => {
  const snapshot = await snapshotProcesses();
  const me = snapshot.find((p) => p.pid === process.pid);
  assert.ok(me, 'current pid present');
  assert.match(me.name, /node/i);
  assert.ok(!Number.isNaN(me.created));
});
