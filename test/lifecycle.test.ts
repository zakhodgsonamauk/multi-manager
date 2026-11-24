import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FRESH_AFTER_IDLE_STOP, FRESH_AFTER_REFRESH, type Command } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, launchProjectManager, restartArchitect, stopSession, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import type { ActivityReaders } from '../src/monitor/activity.ts';
import {
  decideIdleStop,
  decideRefresh,
  lifecycleRow,
  refreshRequestLive,
  runLifecycle,
  type IdleStopInput,
  type RefreshInput,
} from '../src/monitor/lifecycle.ts';
import { answerItem, raiseItem } from '../src/roster/items.ts';
import { endPause, startPause } from '../src/roster/pause.ts';
import { addProject, requireProject } from '../src/roster/projects.ts';
import { requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerHealthTools } from '../src/roster/tools-health.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

// ---- pure decisions --------------------------------------------------------------------------------------------

const refreshBase: RefreshInput = {
  contextTokens: 300_000,
  limitTokens: 200_000,
  status: 'idle',
  ownQuietMs: 10 * 60_000,
  pendingItems: 0,
  noteRequested: false,
  noteReady: false,
  paused: false,
};

test('refresh: below the limit, or size unknown, means no restart', () => {
  assert.equal(decideRefresh({ ...refreshBase, contextTokens: 150_000 }), 'none');
  assert.equal(decideRefresh({ ...refreshBase, contextTokens: 200_000 }), 'none');
  assert.equal(decideRefresh({ ...refreshBase, contextTokens: null }), 'none');
});

test('refresh: over the limit but busy, recently active, paused or with a pending item means no restart', () => {
  assert.equal(decideRefresh({ ...refreshBase, status: 'busy' }), 'none');
  assert.equal(decideRefresh({ ...refreshBase, ownQuietMs: 60_000 }), 'none');
  assert.equal(decideRefresh({ ...refreshBase, paused: true }), 'none');
  // an answered item it has not read, or a developer report it is reviewing
  assert.equal(decideRefresh({ ...refreshBase, pendingItems: 1 }), 'none');
  assert.equal(decideRefresh({ ...refreshBase, pendingItems: 1, noteReady: true }), 'none');
});

test('refresh: over the limit, idle and clean asks for the note, then restarts once it is written', () => {
  assert.equal(decideRefresh(refreshBase), 'request-note');
  assert.equal(decideRefresh({ ...refreshBase, noteRequested: true }), 'none');
  assert.equal(decideRefresh({ ...refreshBase, noteRequested: true, noteReady: true, ownQuietMs: 90_000 }), 'restart');
  assert.equal(decideRefresh({ ...refreshBase, noteRequested: true, noteReady: true, ownQuietMs: 10_000 }), 'none');
});

const stopBase: IdleStopInput = { status: 'idle', ownQuietMinutes: 130, idleStopMinutes: 120, runningChildren: 0, pendingItems: 0, paused: false };

test('idle stop: idle past the limit with nothing under it and nothing waiting stops it, a waiting goal does not matter', () => {
  assert.equal(decideIdleStop(stopBase), true);
  assert.equal(decideIdleStop({ ...stopBase, ownQuietMinutes: 100 }), false);
  assert.equal(decideIdleStop({ ...stopBase, runningChildren: 1 }), false);
  assert.equal(decideIdleStop({ ...stopBase, pendingItems: 1 }), false);
  assert.equal(decideIdleStop({ ...stopBase, status: 'busy' }), false);
  assert.equal(decideIdleStop({ ...stopBase, paused: true }), false);
});

// ---- the pass over real roster rows, with fake processes -------------------------------------------------------

/** Processes are real to the ownership checks: a pid is ours while it is alive, and a taskkill removes it unless killCode says it failed. */
function fakeDeps() {
  const runs: Command[] = [];
  const alive = new Set<number>();
  const control = { killCode: 0, launchCode: 0, notOurs: new Set<number>() };
  let nextPid = 4000;
  const deps: LaunchDeps = {
    run: async (command) => {
      runs.push(command);
      if (command.file === 'taskkill') {
        if (control.killCode === 0) alive.delete(Number(command.args[1]));
        return { code: control.killCode, stdout: '', stderr: '' };
      }
      return { code: control.launchCode, stdout: '', stderr: '' };
    },
    writeSettings: () => {},
    waitForPid: async () => {
      alive.add((nextPid += 1));
      return nextPid;
    },
    findPid: async () => null,
    ownsProcess: async (pid) => alive.has(pid) && !control.notOurs.has(pid),
    waitForWrapperPid: async () => (nextPid += 1),
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
    readClaudeSessionId: (pid) => `conv-${pid}`,
    conversationExists: () => true,
  };
  return { deps, runs, alive, control };
}

/** The claude arguments of the last tab opened. */
function lastClaudeArgs(runs: Command[]): string[] {
  const line = decodeCommand(runs.at(-1)?.args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  return [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

interface Fake {
  status: 'idle' | 'busy';
  contextTokens: number | null;
  /** minutes since the session's own last activity */
  ownQuietMinutes: number;
}

function setup(t: TestContext, project: { idleStopMinutes?: number; contextLimitTokens?: number } = {}) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', ...project });
  const fake = fakeDeps();
  const launch: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const now = new Date('2026-06-01T12:00:00Z');
  const states = new Map<number, Fake>(); // by claude pid
  const readers: ActivityReaders = {
    readSessionFile: (pid) => {
      const s = states.get(pid);
      return s === undefined ? null : { status: s.status, sessionId: `conv-${pid}`, statusUpdatedAt: now.getTime() };
    },
    findTranscript: (id) => id,
    mtimeMs: () => now.getTime(),
    transcriptInfo: (path) => {
      const s = states.get(Number(path.replace('conv-', '')));
      return s === undefined ? null : { contextTokens: s.contextTokens, lastOwnActivityMs: now.getTime() - s.ownQuietMinutes * 60_000 };
    },
  };
  const tools = new Map<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>>();
  const ctx: ToolContext = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: 'I:\\mm', launch };
  registerHealthTools({ registerTool: (name: string, _c: unknown, h: never) => tools.set(name, h) } as unknown as McpServer, ctx, { readers, now: () => now.getTime() });
  const call = async (name: string, as: number) => {
    ctx.identity = { sessionId: as, role: requireSession(db, as).role };
    const result = await tools.get(name)!({});
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return text;
  };
  const digest = async () => JSON.parse(await call('front_desk_digest', desk.id)) as Record<string, unknown>;
  const set = (pid: number | null, s: Partial<Fake>) => {
    states.set(pid as number, { status: 'idle', contextTokens: 50_000, ownQuietMinutes: 10, ...s });
  };
  return { db, desk, launch, fake, now, readers, set, call, digest };
}

test('an idle architect past the limit is asked for its note, says it is ready, and restarts with a fresh conversation', async (t) => {
  const { db, desk, launch, fake, now, readers, set, call, digest } = setup(t, { contextLimitTokens: 100_000 });
  const { session } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  set(session.pid, { contextTokens: 150_000, ownQuietMinutes: 10 });

  const first = await runLifecycle(launch, readers, now);
  assert.deepEqual(first.note_requested.map((n) => n.session_id), [session.id]);
  assert.equal(first.refreshed.length, 0);
  assert.equal(fake.runs.length, 1, 'nothing restarted yet');
  const due = (await digest()).refresh_due as { id: number; message: string }[];
  assert.equal(due[0].id, session.id);
  assert.match(due[0].message, /resume_note_written/);

  // not restarted until it says the note is written
  assert.equal((await runLifecycle(launch, readers, now)).refreshed.length, 0);
  assert.match(await call('resume_note_written', session.id), /Stop now/);
  assert.equal((await digest()).refresh_due, undefined);

  set(session.pid, { contextTokens: 150_000, ownQuietMinutes: 2 });
  const second = await runLifecycle(launch, readers, now);
  assert.deepEqual(second.refreshed.map((n) => n.session_id), [session.id]);
  assert.equal(lifecycleRow(db, session.id), undefined);
  const args = lastClaudeArgs(fake.runs);
  assert.ok(!args.includes('--resume'), 'a fresh conversation, not a resume');
  assert.ok(args.some((a) => a.includes('status.md and progress.md') && a.includes(FRESH_AFTER_REFRESH)));
  assert.equal(requireSession(db, session.id).state, 'running');
});

test('a refresh is not started while an answered item is unread, and a stale note is asked for again', async (t) => {
  const { db, desk, launch, now, readers, set } = setup(t, { contextLimitTokens: 100_000 });
  const { session } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  set(session.pid, { contextTokens: 150_000, ownQuietMinutes: 10 });
  const item = raiseItem(db, { kind: 'question', body: 'which?', raisedBy: session.id, addressedTo: desk.id });
  answerItem(db, item.id, 'this one');
  assert.equal((await runLifecycle(launch, readers, now)).note_requested.length, 0);
  db.prepare("UPDATE items SET seen = 1 WHERE id = ?").run(item.id);
  assert.equal((await runLifecycle(launch, readers, now)).note_requested.length, 1);
  // note written, then the session worked again well after it: the note is stale
  db.prepare('UPDATE manager_lifecycle SET note_ready_at = ? WHERE session_id = ?').run(now.getTime() - 20 * 60_000, session.id);
  set(session.pid, { contextTokens: 150_000, ownQuietMinutes: 10 });
  assert.equal((await runLifecycle(launch, readers, now)).note_requested.length, 1);
});

test('a project manager whose goal waits for sign-off is stopped once idle past the limit, one with a running architect is not', async (t) => {
  const { db, desk, launch, now, readers, set } = setup(t, { idleStopMinutes: 120 });
  const pm = (await launchProjectManager(launch, { project: 'alpha', parentId: desk.id })).session;
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: pm.id })).session;
  db.prepare("INSERT INTO goals (workstream_id, text, state, created_at, updated_at) VALUES (?, 'g', 'awaiting-signoff', 'x', 'x')").run(arch.workstream_id);
  set(pm.pid, { ownQuietMinutes: 200 });
  set(arch.pid, { ownQuietMinutes: 10 });
  assert.equal((await runLifecycle(launch, readers, now)).idle_stopped.length, 0, 'its architect is running');
  assert.equal(requireSession(db, pm.id).state, 'running');

  set(arch.pid, { ownQuietMinutes: 200 });
  const report = await runLifecycle(launch, readers, now);
  assert.deepEqual(report.idle_stopped.map((s) => s.session_id).sort(), [arch.id]);
  // the architect went first; now the manager has no running architect
  set(pm.pid, { ownQuietMinutes: 200 });
  assert.deepEqual((await runLifecycle(launch, readers, now)).idle_stopped.map((s) => s.session_id), [pm.id]);
  assert.equal(requireSession(db, pm.id).state, 'stopped');
  void desk;
});

test('an idle architect with a running developer is not stopped', async (t) => {
  const { launch, now, readers, set, db, desk } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  const dev = (await launchDeveloper(launch, { architectId: arch.id, task: 'do it', label: 'x' })).session;
  set(arch.pid, { ownQuietMinutes: 500 });
  set(dev.pid, { status: 'busy', ownQuietMinutes: 0 });
  assert.equal((await runLifecycle(launch, readers, now)).idle_stopped.length, 0);
  assert.equal(requireSession(db, arch.id).state, 'running');
});

test('a manager whose only recent activity was its own timer check-ins still counts as idle', async (t) => {
  const { launch, now, readers, set, desk, db } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  // the roster check-in and the transcript file time are both "now" (the timer just fired); only its own activity is old
  db.prepare('UPDATE sessions SET last_checkin_at = ? WHERE id = ?').run(now.toISOString(), arch.id);
  set(arch.pid, { ownQuietMinutes: 300 });
  assert.equal((await runLifecycle(launch, readers, now)).idle_stopped.length, 1);
});

test('a stopped manager comes back, fresh and from its notes, when an item is raised to it', async (t) => {
  const { db, desk, launch, fake, now, readers, set } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { ownQuietMinutes: 300 });
  await runLifecycle(launch, readers, now);
  assert.equal(requireSession(db, arch.id).state, 'stopped');
  assert.equal((await runLifecycle(launch, readers, now)).restored.length, 0, 'nothing waiting, stays stopped');

  raiseItem(db, { kind: 'question', body: 'a new goal for you', raisedBy: desk.id, addressedTo: arch.id });
  const report = await runLifecycle(launch, readers, now);
  assert.deepEqual(report.restored.map((r) => r.session_id), [arch.id]);
  const revived = requireSession(db, arch.id);
  assert.equal(revived.state, 'running');
  assert.equal(revived.id, arch.id, 'same roster row');
  const args = lastClaudeArgs(fake.runs);
  assert.ok(!args.includes('--resume'));
  assert.ok(args.some((a) => a.includes(FRESH_AFTER_IDLE_STOP) && a.includes('progress.md')));
  assert.equal(lifecycleRow(db, arch.id), undefined, 'the stop mark is cleared');
});

test('a paused project is neither stopped nor refreshed nor restored', async (t) => {
  const { db, desk, launch, now, readers, set } = setup(t, { idleStopMinutes: 60, contextLimitTokens: 100_000 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { ownQuietMinutes: 300, contextTokens: 500_000 });
  startPause(db, { projectId: requireProject(db, 'alpha').id });
  const report = await runLifecycle(launch, readers, now);
  assert.equal(report.idle_stopped.length + report.note_requested.length, 0);
});


// ---- send-back round 1: safety cases -----------------------------------------------------------------------------

const tabsOpened = (runs: Command[]): number => runs.filter((c) => c.file !== 'taskkill').length;

async function bigIdleArchitect(t: TestContext) {
  const s = setup(t, { contextLimitTokens: 100_000, idleStopMinutes: 100_000 });
  const arch = (await launchArchitect(s.launch, { project: 'alpha', parentId: s.desk.id })).session;
  s.set(arch.pid, { contextTokens: 150_000, ownQuietMinutes: 10 });
  await runLifecycle(s.launch, s.readers, s.now); // asks for the note
  assert.match(await s.call('resume_note_written', arch.id), /Stop now/);
  s.set(arch.pid, { contextTokens: 150_000, ownQuietMinutes: 2 });
  return { ...s, arch };
}

test('refresh: a process that cannot be proven the session own is not killed and no second tab opens', async (t) => {
  const { launch, readers, now, fake, arch, db } = await bigIdleArchitect(t);
  const opened = tabsOpened(fake.runs);
  fake.control.notOurs.add(arch.pid as number);
  const report = await runLifecycle(launch, readers, now);
  assert.equal(report.refreshed.length, 0);
  assert.match(report.errors.join(' '), /could not prove/);
  assert.equal(tabsOpened(fake.runs), opened);
  assert.equal(fake.runs.filter((c) => c.file === 'taskkill').length, 0, 'nothing killed');
  assert.equal(requireSession(db, arch.id).state, 'running');
});

test('refresh: a failed kill opens no second tab and keeps the saved conversation', async (t) => {
  const { launch, readers, now, fake, arch, db } = await bigIdleArchitect(t);
  const opened = tabsOpened(fake.runs);
  const saved = requireSession(db, arch.id).claude_session_id;
  fake.control.killCode = 1;
  const report = await runLifecycle(launch, readers, now);
  assert.equal(report.refreshed.length, 0);
  assert.match(report.errors.join(' '), /killing process .* failed/);
  assert.equal(tabsOpened(fake.runs), opened);
  assert.equal(requireSession(db, arch.id).claude_session_id, saved);
});

test('refresh: if the relaunch fails after the kill, the saved conversation id is put back', async (t) => {
  const { launch, readers, now, fake, arch, db } = await bigIdleArchitect(t);
  const saved = requireSession(db, arch.id).claude_session_id;
  assert.notEqual(saved, null);
  fake.control.launchCode = 1;
  const report = await runLifecycle(launch, readers, now);
  assert.equal(report.refreshed.length, 0);
  assert.match(report.errors.join(' '), /Windows Terminal launch failed/);
  assert.equal(requireSession(db, arch.id).claude_session_id, saved);
});

test('idle stop: unproven process is not stopped, a failed kill leaves it running and records nothing', async (t) => {
  const { db, desk, launch, now, readers, set, fake } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { ownQuietMinutes: 300 });
  fake.control.notOurs.add(arch.pid as number);
  let report = await runLifecycle(launch, readers, now);
  assert.equal(report.idle_stopped.length, 0);
  assert.match(report.errors.join(' '), /could not prove/);
  fake.control.notOurs.clear();
  fake.control.killCode = 1;
  report = await runLifecycle(launch, readers, now);
  assert.equal(report.idle_stopped.length, 0);
  assert.match(report.errors.join(' '), /failed to kill/);
  assert.equal(requireSession(db, arch.id).state, 'running');
  assert.equal(lifecycleRow(db, arch.id)?.idle_stopped_at ?? null, null);
  // and a later item must not "restore" a session that was never stopped
  raiseItem(db, { kind: 'question', body: 'x', raisedBy: desk.id, addressedTo: arch.id });
  fake.control.killCode = 0;
  assert.equal((await runLifecycle(launch, readers, now)).restored.length, 0);
});

test('an information item keeps an idle manager alive: no stop-then-restore loop', async (t) => {
  const { db, desk, launch, now, readers, set, fake } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { ownQuietMinutes: 300 });
  raiseItem(db, { kind: 'info', body: 'fyi', raisedBy: desk.id, addressedTo: arch.id });
  const opened = tabsOpened(fake.runs);
  for (let i = 0; i < 3; i += 1) {
    const report = await runLifecycle(launch, readers, now);
    assert.equal(report.idle_stopped.length + report.restored.length, 0);
  }
  assert.equal(tabsOpened(fake.runs), opened);
  assert.equal(requireSession(db, arch.id).state, 'running');
});

test('a manager the user stopped stays stopped when an item arrives, even after an earlier idle stop', async (t) => {
  const { db, desk, launch, now, readers, set } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { ownQuietMinutes: 300 });
  await runLifecycle(launch, readers, now);
  assert.equal(requireSession(db, arch.id).state, 'stopped');
  // the user brings it back by hand, then stops it on purpose
  await restartArchitect(launch, { sessionId: arch.id, reason: 'a crash' });
  await stopSession(launch, arch.id);
  raiseItem(db, { kind: 'question', body: 'hello', raisedBy: desk.id, addressedTo: arch.id });
  const report = await runLifecycle(launch, readers, now);
  assert.equal(report.restored.length, 0);
  assert.equal(requireSession(db, arch.id).state, 'stopped');
  assert.equal(lifecycleRow(db, arch.id), undefined, 'the old mark is gone');
});

test('an idle-stop mark is dropped when the session runs again (a manual restart, or a pause and resume)', async (t) => {
  const { db, desk, launch, now, readers, set } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { ownQuietMinutes: 300 });
  await runLifecycle(launch, readers, now);
  assert.notEqual(lifecycleRow(db, arch.id)?.idle_stopped_at, undefined);
  const again = await restartArchitect(launch, { sessionId: arch.id, reason: 'resume after a pause' });
  set(again.session.pid, { ownQuietMinutes: 1 });
  await runLifecycle(launch, readers, now);
  assert.equal(lifecycleRow(db, arch.id), undefined);
});

test('no restore while paused; it comes back once the pause ends', async (t) => {
  const { db, desk, launch, now, readers, set } = setup(t, { idleStopMinutes: 60 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { ownQuietMinutes: 300 });
  await runLifecycle(launch, readers, now);
  const { pause } = startPause(db, { projectId: requireProject(db, 'alpha').id });
  raiseItem(db, { kind: 'question', body: 'hello', raisedBy: desk.id, addressedTo: arch.id });
  assert.equal((await runLifecycle(launch, readers, now)).restored.length, 0);
  assert.equal(requireSession(db, arch.id).state, 'stopped');
  endPause(db, pause.id);
  assert.equal((await runLifecycle(launch, readers, now)).restored.length, 1);
});

test('a resume-note request nobody answers expires, and is dropped once the conversation is small again', async (t) => {
  const { db, desk, launch, now, readers, set, digest } = setup(t, { contextLimitTokens: 100_000, idleStopMinutes: 100_000 });
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  set(arch.pid, { contextTokens: 150_000, ownQuietMinutes: 10 });
  await runLifecycle(launch, readers, now);
  assert.ok((await digest()).refresh_due);
  const row = lifecycleRow(db, arch.id);
  assert.equal(refreshRequestLive(row, now.getTime() + 29 * 60_000), true);
  assert.equal(refreshRequestLive(row, now.getTime() + 31 * 60_000), false);
  // the conversation shrank (for example it was summarised): the request is dropped and the digest goes quiet
  set(arch.pid, { contextTokens: 20_000, ownQuietMinutes: 10 });
  await runLifecycle(launch, readers, now);
  assert.equal(lifecycleRow(db, arch.id), undefined);
  assert.equal((await digest()).refresh_due, undefined);
});
