import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Command } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import { findTranscriptIn, readActivity, realActivityReaders, type ActivityReaders } from '../src/monitor/activity.ts';
import { ACTIVITY_GRACE_MS, RESTART_LINE, assessHealth, detectStuck, type HealthInput } from '../src/monitor/health.ts';
import { detectDeaths, runTick, type MonitorDeps } from '../src/monitor/monitor.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { createGoal, updateGoal } from '../src/roster/goals.ts';
import { listItems, raiseItem } from '../src/roster/items.ts';
import { DEFAULT_STALL_MINUTES, getStallMinutes, setLimits } from '../src/roster/limits.ts';
import { endPause, startPause } from '../src/roster/pause.ts';
import { addProject } from '../src/roster/projects.ts';
import { getSessionTask } from '../src/roster/session-tasks.ts';
import { requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerHealthTools } from '../src/roster/tools-health.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { tempDir, tempRoster } from './helpers.ts';

const MIN = 60_000;
const NOW = Date.parse('2026-10-21T12:00:00Z');

function input(partial: Partial<HealthInput>): HealthInput {
  return { role: 'developer', alive: true, status: 'busy', lastActivityMs: NOW, unfinished: true, stallMinutes: 20, nudge: null, now: NOW, ...partial };
}

test('assessHealth: busy and recent is ok, busy and quiet is hung', () => {
  assert.equal(assessHealth(input({ status: 'busy', lastActivityMs: NOW - 19 * MIN })).state, 'ok');
  const hung = assessHealth(input({ status: 'busy', lastActivityMs: NOW - 25 * MIN }));
  assert.deepEqual([hung.state, hung.minutes_quiet, hung.recommended_action], ['hung', 25, 'nudge']);
  // A busy session with recent activity is never stuck, whatever its nudges.
  assert.equal(assessHealth(input({ status: 'busy', nudge: { count: 5, last_nudge_at: NOW } })).recommended_action, 'none');
});

test('assessHealth: idle with done is ok, idle with unfinished work and quiet is stalled', () => {
  assert.equal(assessHealth(input({ status: 'idle', unfinished: false, lastActivityMs: NOW - 120 * MIN })).state, 'ok');
  assert.equal(assessHealth(input({ status: 'idle', unfinished: true, lastActivityMs: NOW - 5 * MIN })).state, 'ok');
  const stalled = assessHealth(input({ status: 'idle', unfinished: true, lastActivityMs: NOW - 21 * MIN }));
  assert.deepEqual([stalled.state, stalled.recommended_action], ['stalled', 'nudge']);
  assert.match(stalled.reason, /no done report/);
  assert.equal(assessHealth(input({ status: 'idle', lastActivityMs: NOW - 21 * MIN, stallMinutes: 30 })).state, 'ok');
  assert.equal(assessHealth(input({ alive: false })).state, 'dead');
});

test('assessHealth: nudge ladder thresholds, reset on activity, architects are never restarted', () => {
  const quiet = NOW - 60 * MIN;
  const at = (count: number, role: 'architect' | 'developer' = 'developer') =>
    assessHealth(input({ role, status: 'idle', lastActivityMs: quiet, nudge: { count, last_nudge_at: quiet + MIN } })).recommended_action;
  assert.equal(at(0), 'nudge');
  assert.equal(at(1), 'nudge');
  assert.equal(at(2), 'restart');
  assert.equal(at(3), 'restart');
  assert.equal(at(1, 'architect'), 'nudge');
  assert.equal(at(2, 'architect'), 'report');
  assert.equal(assessHealth(input({ role: 'architect', alive: false })).recommended_action, 'report');
  assert.equal(assessHealth(input({ alive: false })).recommended_action, 'restart');
  // Real activity after the last nudge resets the count; a quick reply inside the grace does not.
  const nudgedAt = NOW - 50 * MIN;
  const reset = assessHealth(input({ status: 'idle', lastActivityMs: nudgedAt + ACTIVITY_GRACE_MS + MIN, nudge: { count: 2, last_nudge_at: nudgedAt } }));
  assert.deepEqual([reset.nudges, reset.recommended_action], [0, 'nudge']);
  const reply = assessHealth(input({ status: 'idle', lastActivityMs: nudgedAt + MIN, nudge: { count: 2, last_nudge_at: nudgedAt } }));
  assert.deepEqual([reply.nudges, reply.recommended_action], [2, 'restart']);
  // Paused: reported, but nothing recommended.
  assert.equal(assessHealth(input({ status: 'idle', lastActivityMs: quiet, paused: true })).recommended_action, 'none');
});

test('activity: the transcript is found by globbing projects, and last activity is the newest signal', (t) => {
  const home = tempDir(t);
  const sid = '0f1e2d3c-aaaa-bbbb-cccc-123456789abc';
  mkdirSync(join(home, 'projects', 'some-other-project'), { recursive: true });
  mkdirSync(join(home, 'projects', 'I--weird-slug--here'), { recursive: true });
  mkdirSync(join(home, 'sessions'), { recursive: true });
  const transcript = join(home, 'projects', 'I--weird-slug--here', `${sid}.jsonl`);
  writeFileSync(transcript, '{}\n');
  utimesSync(transcript, new Date(NOW - 3 * MIN), new Date(NOW - 3 * MIN));
  writeFileSync(join(home, 'sessions', '777.json'), JSON.stringify({ pid: 777, sessionId: sid, status: 'idle', statusUpdatedAt: NOW - 10 * MIN, updatedAt: NOW - 10 * MIN, cwd: 'C:\\x' }));

  assert.equal(findTranscriptIn(join(home, 'projects'), sid), transcript);
  assert.equal(findTranscriptIn(join(home, 'projects'), 'missing'), null);
  assert.equal(findTranscriptIn(join(home, 'projects'), '../evil'), null);
  assert.equal(findTranscriptIn(join(home, 'nope'), sid), null);

  const readers = realActivityReaders(home);
  const a = readActivity(777, NOW - 60 * MIN, readers);
  assert.deepEqual([a.status, a.last_activity_ms, a.transcript], ['idle', NOW - 3 * MIN, transcript]);
  assert.equal(readActivity(777, NOW - MIN, readers).last_activity_ms, NOW - MIN, 'a newer roster check-in wins');
  const none = readActivity(888, NOW - 60 * MIN, readers);
  assert.deepEqual([none.status, none.last_activity_ms], ['unknown', NOW - 60 * MIN]);
});

/** Fake activity: claude pid → status and last-activity time. Nothing is read from disk. */
function fakeReaders(): ActivityReaders & { set: (pid: number, status: 'busy' | 'idle', at: number) => void } {
  const files = new Map<number, { sessionId: string; status: string; statusUpdatedAt: number }>();
  return {
    set: (pid, status, at) => files.set(pid, { sessionId: `s${pid}`, status, statusUpdatedAt: at }),
    readSessionFile: (pid) => files.get(pid) ?? null,
    findTranscript: () => null,
    mtimeMs: () => null,
  };
}

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Same pattern as pause.test.ts: fake launcher deps, nothing real is started or killed. */
function fakeDeps() {
  const runs: Command[] = [];
  const killed = new Set<number>();
  let nextPid = 4000;
  const deps: LaunchDeps = {
    run: async (command) => {
      runs.push(command);
      if (command.file === 'taskkill') killed.add(Number(command.args[1]));
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: () => {},
    waitForPid: async () => (nextPid += 1),
    findPid: async () => null,
    ownsProcess: async (pid) => !killed.has(pid),
    waitForWrapperPid: async () => null,
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
  };
  return { deps, runs, killed };
}

async function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha' });
  const fake = fakeDeps();
  const launch: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const { session: arch } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  const { session: dev } = await launchDeveloper(launch, { architectId: arch.id, task: 'build the login form', label: 'login' });
  const readers = fakeReaders();
  let now = NOW;
  const ctx: ToolContext = { db, identity: { sessionId: arch.id, role: 'architect' }, pluginRoot: 'I:\\mm', launch };
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler) } as unknown as McpServer;
  registerHealthTools(server, ctx, { readers, now: () => now });
  const as = (sessionId: number) => {
    ctx.identity = { sessionId, role: requireSession(db, sessionId).role };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return JSON.parse(text);
  };
  const setNow = (ms: number) => {
    now = ms;
  };
  return { db, desk, arch, dev, fake, readers, as, call, setNow, launch };
}

test('launchDeveloper stores the task; stall_minutes defaults to 20 and is per project', async (t) => {
  const { db, dev } = await setup(t);
  const stored = getSessionTask(db, dev.id);
  assert.deepEqual([stored?.label, stored?.task], ['login', 'build the login form']);
  assert.equal(getStallMinutes(db, dev.project_id), DEFAULT_STALL_MINUTES);
  setLimits(db, dev.project_id!, { stallMinutes: 45 });
  assert.equal(getStallMinutes(db, dev.project_id), 45);
  setLimits(db, dev.project_id!, { maxProcessesPerSession: 3 });
  assert.equal(getStallMinutes(db, dev.project_id), 45, 'other limits keep the stall threshold');
  assert.throws(() => setLimits(db, dev.project_id!, { stallMinutes: 0 }), /stall_minutes/);
});

test('team_health, record_nudge and restart_developer walk the ladder', async (t) => {
  const { db, desk, arch, dev, fake, readers, as, call, setNow } = await setup(t);
  // The roster check-in at launch is real time; run the clock 30 minutes past it.
  const later = Date.now() + 30 * MIN;
  readers.set(dev.pid!, 'idle', Date.now());
  readers.set(arch.pid!, 'busy', later);
  setNow(later);

  let health = await call('team_health');
  assert.equal(health.paused, false);
  assert.equal(health.sessions.length, 1);
  assert.deepEqual(
    [health.sessions[0].session_id, health.sessions[0].state, health.sessions[0].status, health.sessions[0].nudges, health.sessions[0].recommended_action],
    [dev.id, 'stalled', 'idle', 0, 'nudge'],
  );
  assert.ok(health.sessions[0].minutes_quiet >= 29);

  assert.deepEqual(await call('record_nudge', { session_id: dev.id }), { session_id: dev.id, name: dev.name, nudges: 1 });
  assert.equal((await call('record_nudge', { session_id: dev.id })).nudges, 2);
  health = await call('team_health');
  assert.deepEqual([health.sessions[0].nudges, health.sessions[0].recommended_action], [2, 'restart']);

  as(desk.id);
  const desk_view = await call('team_health');
  assert.deepEqual(desk_view.sessions.map((s: { session_id: number }) => s.session_id), [arch.id]);
  assert.equal(desk_view.sessions[0].state, 'ok');
  assert.deepEqual(desk_view.sessions[0].developers.stalled, [dev.name]);
  await assert.rejects(call('restart_developer', { session_id: dev.id }), /Only an architect/);

  as(arch.id);
  const runsBefore = fake.runs.length;
  const restarted = await call('restart_developer', { session_id: dev.id });
  assert.notEqual(restarted.session.id, dev.id);
  assert.equal(restarted.session.name, dev.name);
  assert.equal(restarted.replaced_session_id, dev.id);
  assert.equal(requireSession(db, dev.id).state, 'stopped');
  assert.ok(fake.killed.has(dev.pid!));
  const launched = fake.runs.slice(runsBefore).filter((c) => c.file !== 'taskkill');
  assert.equal(launched.length, 1);
  const script = decodeCommand(launched[0].args.at(-1) ?? '');
  assert.match(script, /build the login form/);
  assert.match(script, /You were restarted after stalling\. Check your branch and worktree for earlier work before starting again\./);
  assert.equal(getSessionTask(db, restarted.session.id)?.task, 'build the login form', 'the stored task does not pile up restart lines');
  assert.ok(!getSessionTask(db, restarted.session.id)?.task.includes(RESTART_LINE));

  // The new developer starts with a clean ladder.
  health = await call('team_health');
  assert.deepEqual(health.sessions.map((s: { session_id: number; nudges: number }) => [s.session_id, s.nudges]), [[restarted.session.id, 0]]);
});

test('restart_developer is refused while paused and for sessions that are not yours', async (t) => {
  const { db, dev, fake, as, call } = await setup(t);
  startPause(db, { projectId: dev.project_id });
  const runsBefore = fake.runs.length;
  await assert.rejects(call('restart_developer', { session_id: dev.id }), /paused/);
  assert.equal(fake.runs.length, runsBefore, 'nothing stopped or launched while paused');
  assert.equal(requireSession(db, dev.id).state, 'running');
  assert.equal((await call('team_health')).paused, true);
  as(dev.id);
  await assert.rejects(call('team_health'), /Only architects and the front desk/);
  await assert.rejects(call('record_nudge', { session_id: dev.id }), /not one of yours/);
});

test('team_health reports a developer the monitor found dead, until it is restarted', async (t) => {
  const { db, arch, dev, call } = await setup(t);
  const snapshot: ProcessInfo[] = [{ pid: arch.pid!, ppid: 1, name: 'claude.exe', created: 1, commandLine: null }];
  assert.equal(detectDeaths(db, snapshot).length, 1);
  const health = await call('team_health');
  assert.deepEqual(health.sessions.map((s: { session_id: number; state: string; recommended_action: string }) => [s.session_id, s.state, s.recommended_action]), [
    [dev.id, 'dead', 'restart'],
  ]);
  const restarted = await call('restart_developer', { session_id: dev.id });
  const after = await call('team_health');
  assert.deepEqual(after.sessions.map((s: { session_id: number }) => s.session_id), [restarted.session.id]);
});

test('watcher: one blocked item per stuck episode, a new one after fresh activity', async (t) => {
  const { db, arch, dev, readers } = await setup(t);
  const start = Date.now() + 60 * MIN;
  readers.set(arch.pid!, 'idle', start); // idle with no goals: never stuck
  readers.set(dev.pid!, 'busy', start - 30 * MIN);

  const first = detectStuck(db, readers, new Date(start));
  assert.deepEqual(first.map((s) => [s.session_id, s.state]), [[dev.id, 'hung']]);
  const items = listItems(db, { addressedTo: arch.id });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'blocked');
  assert.match(items[0].body, new RegExp(`^${dev.name} looks stuck: busy but no activity, quiet 30 min$`));

  assert.deepEqual(detectStuck(db, readers, new Date(start + MIN)), []);
  // A quick reply to a nudge (inside the grace) is the same episode.
  readers.set(dev.pid!, 'idle', start + 2 * MIN);
  assert.deepEqual(detectStuck(db, readers, new Date(start + 40 * MIN)), []);
  assert.equal(listItems(db, { addressedTo: arch.id }).length, 1);

  // Real activity, then quiet again: a new episode, a second item.
  readers.set(dev.pid!, 'idle', start + 20 * MIN);
  assert.deepEqual(detectStuck(db, readers, new Date(start + 30 * MIN)), [], 'active again: not stuck');
  const second = detectStuck(db, readers, new Date(start + 45 * MIN));
  assert.deepEqual(second.map((s) => [s.session_id, s.state]), [[dev.id, 'stalled']]);
  assert.equal(listItems(db, { addressedTo: arch.id }).length, 2);

  // A developer that reported done is idle, not stuck.
  raiseItem(db, { kind: 'done', body: 'login done', raisedBy: dev.id });
  readers.set(dev.pid!, 'idle', start + 100 * MIN);
  assert.deepEqual(detectStuck(db, readers, new Date(start + 200 * MIN)), []);
});

test('watcher: architects stall on unfinished goals and are reported to the front desk; paused projects are skipped; runTick wires it in', async (t) => {
  const { db, desk, arch, dev, readers } = await setup(t);
  const start = Date.now() + 60 * MIN;
  raiseItem(db, { kind: 'done', body: 'done', raisedBy: dev.id });
  readers.set(dev.pid!, 'idle', start - 60 * MIN);
  readers.set(arch.pid!, 'idle', start - 60 * MIN);
  assert.deepEqual(detectStuck(db, readers, new Date(start)), [], 'no goals in planning or in progress');

  const goal = createGoal(db, { workstreamId: arch.workstream_id!, text: 'auth' });
  updateGoal(db, goal.id, { state: 'in-progress' });
  const pause = startPause(db, { projectId: arch.project_id });
  assert.deepEqual(detectStuck(db, readers, new Date(start)), [], 'paused');
  endPause(db, pause.pause.id);

  const snapshot: ProcessInfo[] = [
    { pid: arch.pid!, ppid: 1, name: 'claude.exe', created: 1, commandLine: null },
    { pid: dev.pid!, ppid: 1, name: 'claude.exe', created: 1, commandLine: null },
  ];
  const deps: MonitorDeps = {
    snapshot: () => Promise.resolve(snapshot),
    kill: () => Promise.reject(new Error('never kills')),
    now: () => new Date(start),
    activity: readers,
  };
  const tick = await runTick(db, deps);
  assert.deepEqual(tick.errors, []);
  assert.deepEqual(tick.stuck.map((s) => [s.session_id, s.state]), [[arch.id, 'stalled']]);
  const toDesk = listItems(db, { addressedTo: desk.id }).filter((i) => i.kind === 'blocked');
  assert.equal(toDesk.length, 1);
  assert.match(toDesk[0].body, /looks stuck: idle with goals still in planning or in progress, quiet 60 min/);
  assert.deepEqual((await runTick(db, deps)).stuck, []);
});
