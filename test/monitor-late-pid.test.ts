import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { cwdWithin, findSessionPid, readSessionFile } from '../src/launch/process.ts';
import type { RunResult } from '../src/launch/runner.ts';
import { runTick, type MonitorDeps } from '../src/monitor/monitor.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { listItems } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempDir, tempRoster } from './helpers.ts';

const CONVERSATION = '0f1e2d3c-aaaa-bbbb-cccc-123456789abc';
const NOW = new Date('2026-10-23T12:00:00Z');

function proc(pid: number, name: string): ProcessInfo {
  return { pid, ppid: 1, name, created: pid * 10, commandLine: null };
}

/**
 * A temp roster with a running architect (pid known) and a developer whose pid was never found at launch
 * (the "trust this folder?" prompt held it past the launch wait). Session files live in a temp folder.
 */
function setup(t: TestContext) {
  const db = tempRoster(t);
  const sessionsDir = tempDir(t);
  const desk = startFrontDesk(db, undefined, NOW);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main', pid: 10 }, NOW);
  const dev = registerSession(db, { role: 'developer', parentId: arch.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main-dev-x' }, NOW);
  const sessionFile = (pid: number, name: string, sessionId: string = CONVERSATION, cwd: string = 'C:\\a') =>
    writeFileSync(join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, name, sessionId, startedAt: pid, cwd }));
  sessionFile(10, arch.name as string, 'arch-conversation');
  const deps = (snapshot: ProcessInfo[]): MonitorDeps => ({
    snapshot: () => Promise.resolve(snapshot),
    kill: (): Promise<RunResult> => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
    now: () => NOW,
    selfPid: 1,
    findSessionPid: (name, isLive, within) => findSessionPid(name, { dir: sessionsDir, isLive, within }),
    activity: { readSessionFile: (pid) => readSessionFile(pid, sessionsDir), findTranscript: () => null, mtimeMs: () => null },
  });
  return { db, desk, arch, dev, sessionFile, deps };
}

const base = [proc(1, 'node.exe'), proc(10, 'claude.exe')];

test('a running developer launched without a pid gets its pid and conversation recorded on the next tick', async (t) => {
  const { db, dev, sessionFile, deps } = setup(t);
  // A developer runs in its worktree, which lives under the project folder.
  sessionFile(30, dev.name as string, CONVERSATION, `c:/A/.claude/worktrees/${dev.name}`);
  const result = await runTick(db, deps([...base, proc(30, 'claude.exe')]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.deaths, []);
  const row = requireSession(db, dev.id);
  assert.deepEqual([row.state, row.pid, row.claude_session_id], ['running', 30, CONVERSATION]);
});

test('a pid-less session with no live claude for its name stays as it was, and nothing else changes', async (t) => {
  const { db, desk, arch, dev, sessionFile, deps } = setup(t);
  // A stale file of a dead process, and a file whose pid now belongs to some other program.
  sessionFile(31, dev.name as string);
  sessionFile(32, dev.name as string);
  const archBefore = requireSession(db, arch.id);
  const result = await runTick(db, deps([...base, proc(32, 'notepad.exe')]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.deaths, []);
  const row = requireSession(db, dev.id);
  assert.deepEqual([row.state, row.pid, row.claude_session_id], ['running', null, null]);
  assert.deepEqual(requireSession(db, arch.id), { ...archBefore, claude_session_id: 'arch-conversation' });
  assert.equal(listItems(db, { addressedTo: desk.id }).length + listItems(db, { addressedTo: arch.id }).length, 0);
});

test('a live claude for a different name is never adopted', async (t) => {
  const { db, dev, sessionFile, deps } = setup(t);
  sessionFile(33, 'mm-alpha-main-dev-other', 'other-conversation');
  await runTick(db, deps([...base, proc(33, 'claude.exe')]));
  const row = requireSession(db, dev.id);
  assert.deepEqual([row.pid, row.claude_session_id], [null, null]);
});

test('a pid already recorded for another running session is not given to a second one', async (t) => {
  const { db, arch, dev, sessionFile, deps } = setup(t);
  // Same name as the architect's file would be a bug elsewhere; here the developer's name points at the architect's pid.
  sessionFile(10, dev.name as string);
  await runTick(db, deps(base));
  assert.equal(requireSession(db, dev.id).pid, null);
  assert.equal(requireSession(db, arch.id).pid, 10);
});

test("a same-named live claude in another cluster's folder is never adopted, nor one in a folder that only starts the same", async (t) => {
  const { db, dev, sessionFile, deps } = setup(t);
  // Another cluster's project alpha has a tab of the same name.
  sessionFile(34, dev.name as string, 'other-cluster', 'D:\\cluster-b\\alpha');
  sessionFile(35, dev.name as string, 'prefix', 'C:\\a2\\.claude\\worktrees\\x');
  await runTick(db, deps([...base, proc(34, 'claude.exe'), proc(35, 'claude.exe')]));
  const row = requireSession(db, dev.id);
  assert.deepEqual([row.pid, row.claude_session_id], [null, null]);
});

test('cwdWithin compares Windows paths: case, separators and trailing separators ignored, never a bare prefix', () => {
  assert.equal(cwdWithin('C:\\work\\alpha', 'C:\\work\\alpha'), true);
  assert.equal(cwdWithin('c:/WORK/alpha/', 'C:\\work\\alpha\\'), true);
  assert.equal(cwdWithin('C:\\work\\alpha\\.claude\\worktrees\\mm-a', 'C:\\work\\alpha'), true);
  assert.equal(cwdWithin('D:\\', 'D:\\'), true);
  assert.equal(cwdWithin('D:\\x', 'D:\\'), true);
  assert.equal(cwdWithin('C:\\work\\alpha2', 'C:\\work\\alpha'), false);
  assert.equal(cwdWithin('C:\\work', 'C:\\work\\alpha'), false);
  assert.equal(cwdWithin('C:\\work\\alpha\\..\\beta', 'C:\\work\\alpha'), false);
  assert.equal(cwdWithin(undefined, 'C:\\work\\alpha'), false);
  assert.equal(cwdWithin('', 'C:\\work\\alpha'), false);
  assert.equal(cwdWithin('C:\\work\\alpha', ''), false);
});
