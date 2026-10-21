import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActivityReaders } from '../src/monitor/activity.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { readVoiceSetting, registerVoiceTools, voiceDir, writeVoiceSetting } from '../src/roster/tools-voice.ts';
import { tempDir, tempRoster } from './helpers.ts';

test('voiceDir is ~/.claude/session-voice under the given home', () => {
  assert.equal(voiceDir(join('C:', 'Users', 'z')), join('C:', 'Users', 'z', '.claude', 'session-voice'));
});

test('writeVoiceSetting writes one switch file and removes the other', (t) => {
  const dir = tempDir(t);
  assert.equal(readVoiceSetting(dir, 'abc'), null);
  writeVoiceSetting(dir, 'abc', false);
  assert.equal(existsSync(join(dir, 'muted', 'abc')), true);
  assert.equal(readVoiceSetting(dir, 'abc'), 'off');
  writeVoiceSetting(dir, 'abc', true);
  assert.equal(existsSync(join(dir, 'muted', 'abc')), false);
  assert.equal(readVoiceSetting(dir, 'abc'), 'on');
  assert.throws(() => writeVoiceSetting(dir, '../escape', true), /Not a Claude Code session id/);
});

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function harness(t: TestContext) {
  const db = tempRoster(t);
  const dir = tempDir(t);
  const desk = startFrontDesk(db);
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, name: 'mm-a-main', pid: 101 });
  const dev = registerSession(db, { role: 'developer', parentId: arch.id, name: 'mm-a-main-dev', pid: 102 });
  const files: Record<number, unknown> = { 101: { sessionId: 'claude-arch' }, 102: { sessionId: 'claude-dev' }, 900: { sessionId: 'claude-desk' } };
  const readers: ActivityReaders = { readSessionFile: (pid) => files[pid] ?? null, findTranscript: () => null, mtimeMs: () => null };
  const ctx = { db, identity: { sessionId: desk.id, role: 'front-desk' } } as unknown as ToolContext;
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler) } as unknown as McpServer;
  registerVoiceTools(server, ctx, { readers, dir, findPid: async (name) => (name === desk.name ? 900 : null) });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return JSON.parse(text);
  };
  const as = (id: number, role: 'front-desk' | 'architect' | 'developer') => {
    ctx.identity = { sessionId: id, role };
  };
  return { db, desk, arch, dev, dir, call, as };
}

test('voice_status: front desk speaks, launched sessions start muted', async (t) => {
  const { call } = harness(t);
  const rows = await call('voice_status');
  assert.deepEqual(
    rows.map((r: { name: string; claude_session_id: string; voice: string }) => [r.name, r.claude_session_id, r.voice]),
    [
      ['mm-front-desk', 'claude-desk', 'on'],
      ['mm-a-main', 'claude-arch', 'off'],
      ['mm-a-main-dev', 'claude-dev', 'off'],
    ],
  );
});

test('set_voice: front desk unmutes an architect and mutes itself (desk found by name)', async (t) => {
  const { desk, arch, dir, call } = harness(t);
  assert.deepEqual(await call('set_voice', { session_id: arch.id, on: true }), {
    session_id: arch.id,
    name: 'mm-a-main',
    claude_session_id: 'claude-arch',
    voice: 'on',
  });
  assert.equal(existsSync(join(dir, 'unmuted', 'claude-arch')), true);
  await call('set_voice', { session_id: desk.id, on: false });
  assert.equal(existsSync(join(dir, 'muted', 'claude-desk')), true);
  const [only] = await call('voice_status', { session_id: arch.id });
  assert.deepEqual([only.voice, only.reason], ['on', 'set with set_voice or /voice']);
});

test('set_voice: a session may set only its own voice', async (t) => {
  const { arch, dev, dir, call, as } = harness(t);
  as(dev.id, 'developer');
  await call('set_voice', { session_id: dev.id, on: true });
  assert.equal(readVoiceSetting(dir, 'claude-dev'), 'on');
  await assert.rejects(call('set_voice', { session_id: arch.id, on: true }), /Only the front desk/);
});

test('set_voice: refuses a session with no Claude Code session to find', async (t) => {
  const { db, desk, call } = harness(t);
  const ghost = registerSession(db, { role: 'architect', parentId: desk.id, name: 'mm-gone' });
  await assert.rejects(call('set_voice', { session_id: ghost.id, on: true }), /no running Claude Code session/);
  const [row] = await call('voice_status', { session_id: ghost.id });
  assert.deepEqual([row.claude_session_id, row.voice], [null, 'off']);
});
