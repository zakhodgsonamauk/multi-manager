import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { launchArchitect, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import { readActivity, realActivityReaders } from '../src/monitor/activity.ts';
import { runTick, type MonitorDeps } from '../src/monitor/monitor.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { raiseItem } from '../src/roster/items.ts';
import { addProject } from '../src/roster/projects.ts';
import { requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerHealthTools } from '../src/roster/tools-health.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { tempDir, tempRoster } from './helpers.ts';

/**
 * The whole path through the monitor's own tick, with real Claude Code files (session file + transcript, written
 * into a throwaway Claude home) and a fake process layer. Nothing is launched for real.
 */
test('end to end through the monitor tick: refresh at a low limit, then idle stop and bring-back on an item', async (t) => {
  const home = tempDir(t);
  mkdirSync(join(home, 'sessions'), { recursive: true });
  mkdirSync(join(home, 'projects', 'p'), { recursive: true });
  const now = new Date('2026-06-01T12:00:00Z');
  const ago = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
  const call = (id: string, usage: number, ts: string) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { usage: { input_tokens: 2, cache_read_input_tokens: usage - 2, cache_creation_input_tokens: 0 } } });
  const turn = (origin: string, ts: string) => JSON.stringify({ type: 'user', timestamp: ts, turnOrigin: origin, message: { content: 'x' } });
  const writeSession = (pid: number, sessionId: string, lines: string[]) => {
    writeFileSync(join(home, 'sessions', `${pid}.json`), JSON.stringify({ status: 'idle', sessionId, statusUpdatedAt: now.getTime() }));
    writeFileSync(join(home, 'projects', 'p', `${sessionId}.jsonl`), `${lines.join('\n')}\n`);
  };

  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', contextLimitTokens: 40_000, idleStopMinutes: 30 });
  const runs: string[][] = [];
  let nextPid = 7000;
  const alive = new Set<number>();
  const deps: LaunchDeps = {
    run: async (command) => {
      const line = decodeCommand(command.args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
      if (command.file === 'taskkill') alive.delete(Number(command.args[1]));
      if (line !== '') runs.push([...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")));
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: () => {},
    waitForPid: async () => {
      alive.add((nextPid += 1));
      return nextPid;
    },
    findPid: async () => null,
    ownsProcess: async (pid) => alive.has(pid),
    waitForWrapperPid: async () => null,
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
    readClaudeSessionId: (pid) => `conv-${pid}`,
    conversationExists: () => true,
  };
  const launch: LaunchContext = { db, deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const readers = realActivityReaders(home);
  const monitor: MonitorDeps = {
    snapshot: async (): Promise<ProcessInfo[]> => [1, ...alive].map((pid) => ({ pid, ppid: 1, name: 'claude.exe', created: 1, commandLine: null })),
    kill: async () => ({ code: 0, stdout: '', stderr: '' }),
    now: () => now,
    activity: readers,
    launch,
  };

  // The tools the manager and the front desk call.
  const tools = new Map<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>>();
  const ctx: ToolContext = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: 'I:\\mm', launch };
  registerHealthTools({ registerTool: (name: string, _c: unknown, h: never) => tools.set(name, h) } as unknown as McpServer, ctx, { readers, now: () => now.getTime() });
  const as = async (id: number, name: string) => {
    ctx.identity = { sessionId: id, role: requireSession(db, id).role };
    const result = await tools.get(name)!({});
    return result.content.map((c) => c.text).join('\n');
  };

  // 1. A big architect, idle for 20 minutes, whose only recent turn was its own timer check-in.
  const arch = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  const pid1 = arch.pid as number;
  writeSession(pid1, `conv-${pid1}`, [turn('human', ago(25)), call('a', 60_000, ago(20)), turn('scheduled', ago(1)), call('b', 61_000, ago(1))]);
  const before = readActivity(pid1, Date.parse(ago(1)), readers);
  assert.equal(before.context_tokens, 61_000);
  assert.equal(Math.round((now.getTime() - (before.own_activity_ms as number)) / 60_000), 20, 'the timer turn does not count');

  const first = await runTick(db, monitor);
  assert.deepEqual(first.lifecycle?.note_requested.map((n) => n.session_id), [arch.id]);
  assert.match(await as(desk.id, 'front_desk_digest'), /refresh_due/);
  assert.match(await as(arch.id, 'resume_note_written'), /Stop now/);

  const second = await runTick(db, monitor);
  assert.deepEqual(second.lifecycle?.refreshed.map((n) => n.session_id), [arch.id]);
  const fresh = requireSession(db, arch.id);
  assert.equal(fresh.state, 'running');
  assert.ok(runs.length >= 2 && !runs.at(-1)!.includes('--resume'));
  assert.ok(runs.at(-1)!.some((a) => /status\.md and progress\.md/.test(a)));
  // The new conversation is small.
  const pid2 = fresh.pid as number;
  writeSession(pid2, `conv-${pid2}`, [turn('human', ago(0.5)), call('c', 12_000, ago(0.4))]);
  const after = readActivity(pid2, now.getTime(), readers);
  process.stdout.write(`context before restart ${before.context_tokens} tokens, after ${after.context_tokens} tokens\n`);
  assert.equal(after.context_tokens, 12_000);

  // 2. An item arrives for the fresh session: it is busy with it, so nothing is stopped or refreshed.
  raiseItem(db, { kind: 'question', body: 'new goal', raisedBy: desk.id, addressedTo: arch.id });
  writeSession(pid2, `conv-${pid2}`, [turn('human', ago(300)), call('d', 12_000, ago(300))]);
  const busy = await runTick(db, monitor);
  assert.equal(busy.lifecycle?.idle_stopped.length, 0, 'an open item keeps it alive');

  // 3. Idle past idle_stop_minutes with nothing waiting: stopped. An item is raised: it comes back.
  db.prepare("UPDATE items SET state = 'closed'").run();
  const stopTick = await runTick(db, monitor);
  assert.deepEqual(stopTick.lifecycle?.idle_stopped.map((s) => s.session_id), [arch.id]);
  assert.equal(requireSession(db, arch.id).state, 'stopped');
  raiseItem(db, { kind: 'question', body: 'please plan goal 9', raisedBy: desk.id, addressedTo: arch.id });
  const back = await runTick(db, monitor);
  assert.deepEqual(back.lifecycle?.restored.map((r) => r.session_id), [arch.id]);
  assert.equal(requireSession(db, arch.id).state, 'running');
  assert.ok(runs.at(-1)!.some((a) => /stopped while idle/.test(a) && /progress\.md/.test(a)));
  process.stdout.write('idle stop and bring-back on an item: ok\n');
});
