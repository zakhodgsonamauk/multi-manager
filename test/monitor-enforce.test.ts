import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesBinary, planEnforcement, resourceReport, type Limits, type MonitoredSession } from '../src/monitor/enforce.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';

function proc(pid: number, ppid: number, name: string, created: number): ProcessInfo {
  return { pid, ppid, name, created, commandLine: null };
}

function session(id: number, rootPid: number, projectId: number | null = 1, parentId: number | null = 100): MonitoredSession {
  return { id, role: 'developer', parent_id: parentId, project_id: projectId, name: `dev-${id}`, root_pid: rootPid };
}

function limits(partial: Partial<Limits> = {}): Limits {
  return { project_id: 1, max_processes_per_session: null, session_binary_caps: {}, machine_binary_caps: {}, ...partial };
}

const killedPids = (plan: ReturnType<typeof planEnforcement>): number[] => plan.flatMap((e) => e.kills.map((k) => k.pid)).sort((a, b) => a - b);

test('matchesBinary is case-insensitive, extension-tolerant and supports wildcards', () => {
  assert.ok(matchesBinary('Godot.EXE', 'godot.exe'));
  assert.ok(matchesBinary('godot.exe', 'godot'));
  assert.ok(matchesBinary('Godot_v4.3-stable_win64.exe', 'godot*'));
  assert.ok(!matchesBinary('godotx.exe', 'godot.exe'));
});

test('a per-session binary cap kills the newest excess, each with its whole subtree', () => {
  const snap = [
    proc(10, 1, 'claude.exe', 100),
    proc(11, 10, 'godot.exe', 200),
    proc(12, 10, 'godot.exe', 300),
    proc(13, 10, 'godot.exe', 400),
    proc(14, 10, 'pwsh.exe', 450),
    proc(15, 14, 'godot.exe', 500),
    proc(16, 15, 'crash-handler.exe', 600),
  ];
  const plan = planEnforcement(snap, [session(1, 10)], [limits({ session_binary_caps: { 'godot.exe': 2 } })]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].rule, 'session_binary_cap');
  assert.equal(plan[0].count, 4);
  assert.equal(plan[0].cap, 2);
  assert.deepEqual(plan[0].kills.map((k) => k.pid), [15, 13]);
  assert.deepEqual(plan[0].kills[0].subtree, [{ pid: 16, name: 'crash-handler.exe' }]);
  assert.match(plan[0].reason, /4 godot\.exe processes in session #1 \(dev-1\), cap 2/);
});

test('a nested godot counts once even when its parent godot is killed', () => {
  const snap = [proc(10, 1, 'claude.exe', 100), proc(11, 10, 'godot.exe', 200), proc(12, 10, 'godot.exe', 300), proc(13, 12, 'godot.exe', 400)];
  const plan = planEnforcement(snap, [session(1, 10)], [limits({ session_binary_caps: { godot: 1 } })]);
  // Newest is 13 (one kill, count 3 → 2), then 12 (count → 1).
  assert.deepEqual(killedPids(plan), [12, 13]);
});

test('max processes per session never kills the session root', () => {
  const snap = [proc(10, 1, 'claude.exe', 100), proc(11, 10, 'a.exe', 200), proc(12, 10, 'b.exe', 300), proc(13, 10, 'c.exe', 400)];
  const plan = planEnforcement(snap, [session(1, 10)], [limits({ max_processes_per_session: 1 })]);
  assert.deepEqual(killedPids(plan), [12, 13]);
  assert.equal(planEnforcement(snap, [session(1, 10)], [limits({ max_processes_per_session: 0 })]).flatMap((e) => e.kills).some((k) => k.pid === 10), false);
});

test('a machine-wide cap counts across two sessions and kills the newest overall', () => {
  const snap = [
    proc(10, 1, 'claude.exe', 100),
    proc(11, 10, 'godot.exe', 200),
    proc(12, 10, 'godot.exe', 700),
    proc(20, 1, 'claude.exe', 100),
    proc(21, 20, 'godot.exe', 300),
    proc(22, 20, 'godot.exe', 800),
  ];
  const plan = planEnforcement(snap, [session(1, 10), session(2, 20)], [limits({ machine_binary_caps: { 'godot.exe': 2 } })]);
  assert.deepEqual(killedPids(plan), [12, 22]);
  assert.deepEqual(plan.map((e) => [e.session_id, e.rule, e.count, e.cap]).sort(), [
    [1, 'machine_binary_cap', 4, 2],
    [2, 'machine_binary_cap', 4, 2],
  ]);
});

test('per-session kills are counted before the machine-wide cap is checked', () => {
  const snap = [
    proc(10, 1, 'claude.exe', 100),
    proc(11, 10, 'godot.exe', 200),
    proc(12, 10, 'godot.exe', 300),
    proc(13, 10, 'godot.exe', 900),
    proc(20, 1, 'claude.exe', 100),
    proc(21, 20, 'godot.exe', 400),
  ];
  const plan = planEnforcement(snap, [session(1, 10), session(2, 20)], [
    limits({ session_binary_caps: { 'godot.exe': 2 }, machine_binary_caps: { 'godot.exe': 3 } }),
  ]);
  assert.deepEqual(killedPids(plan), [13]);
});

test('processes outside roster session trees are never candidates', () => {
  const snap = [
    proc(10, 1, 'claude.exe', 100),
    proc(11, 10, 'godot.exe', 200),
    proc(50, 1, 'godot.exe', 900), // the user's own Godot editor
    proc(51, 1, 'godot.exe', 950),
    proc(60, 99, 'claude.exe', 100), // a session that is not running / not registered
    proc(61, 60, 'godot.exe', 999),
  ];
  const plan = planEnforcement(snap, [session(1, 10)], [limits({ machine_binary_caps: { 'godot.exe': 0 } })]);
  assert.deepEqual(killedPids(plan), [11]);
  assert.equal(plan[0].count, 1, 'only roster sessions count toward the machine-wide cap');
});

test('a session nested inside another session tree belongs to itself, and its root is untouchable', () => {
  const snap = [
    proc(10, 1, 'claude.exe', 100),
    proc(11, 10, 'pwsh.exe', 200),
    proc(12, 11, 'claude.exe', 300), // a nested session's root
    proc(13, 12, 'godot.exe', 400),
    proc(14, 12, 'godot.exe', 500),
  ];
  const sessions = [session(1, 10), session(2, 12, 2)];
  const outer = planEnforcement(snap, sessions, [limits({ max_processes_per_session: 0 })]);
  assert.deepEqual(killedPids(outer), [], 'pwsh 11 holds a session root below it, so it is not killed');
  const inner = planEnforcement(snap, sessions, [limits({ project_id: 2, session_binary_caps: { 'godot.exe': 1 } })]);
  assert.deepEqual(killedPids(inner), [14]);
  assert.equal(inner[0].session_id, 2);
});

test('protected pids (the monitor host) are never killed', () => {
  const snap = [proc(10, 1, 'claude.exe', 100), proc(11, 10, 'node.exe', 200), proc(12, 11, 'godot.exe', 300)];
  const plan = planEnforcement(snap, [session(1, 10)], [limits({ max_processes_per_session: 0 })], { protectedPids: new Set([11]) });
  assert.deepEqual(killedPids(plan), [12]);
});

test('pid reuse: an orphan whose parent pid now belongs to a session root is not in its tree', () => {
  const snap = [proc(10, 1, 'claude.exe', 1000), proc(11, 10, 'godot.exe', 500)];
  assert.deepEqual(planEnforcement(snap, [session(1, 10)], [limits({ session_binary_caps: { 'godot.exe': 0 } })]), []);
});

test('resourceReport shows counts, caps and over/under per session', () => {
  const snap = [proc(10, 1, 'claude.exe', 100), proc(11, 10, 'godot.exe', 200), proc(12, 10, 'godot.exe', 300), proc(20, 1, 'claude.exe', 100), proc(21, 20, 'godot.exe', 300)];
  const report = resourceReport(snap, [session(1, 10), session(2, 20), session(3, 30)], [
    limits({ max_processes_per_session: 5, session_binary_caps: { 'godot.exe': 1 }, machine_binary_caps: { 'godot.exe': 6 } }),
  ]);
  assert.equal(report[0].process_count, 2);
  assert.deepEqual(report[0].binaries, [{ binary: 'godot.exe', count: 2, session_cap: 1, machine_cap: 6, machine_count: 3, over: true }]);
  assert.equal(report[0].over_max, false);
  assert.equal(report[1].binaries[0].over, false);
  assert.equal(report[2].alive, false);
});
