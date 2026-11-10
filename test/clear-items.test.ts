import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { answerItem, raiseItem, requireItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { registerRosterTools, type ToolContext } from '../src/roster/tools.ts';
import { minutesBefore, tempRoster } from './helpers.ts';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const ctx = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: '', launch: {} } as unknown as ToolContext;
  const tools = new Map<string, Handler>();
  registerRosterTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as unknown as McpServer, ctx);
  const call = async (args: Record<string, unknown>) => {
    const result = await tools.get('clear_items')!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return JSON.parse(text) as { count: number; information: number[]; action: number[] };
  };
  const raise = (kind: 'info' | 'done' | 'signoff', minutes: number, to: number = desk.id) =>
    raiseItem(db, { kind, body: `${kind} ${minutes}`, addressedTo: to }, minutesBefore(new Date(), minutes)).id;
  return { db, desk, arch, ctx, call, raise };
}

test('clear_items 60 closes information items older than 60 minutes and keeps newer and action items', async (t) => {
  const { db, call, raise } = setup(t);
  const old = raise('info', 61);
  const oldDone = raise('done', 120);
  const newer = raise('info', 59);
  const decision = raise('signoff', 500);
  const result = await call({ older_than_minutes: 60 });
  assert.deepEqual(result, { count: 2, information: [old, oldDone], action: [] });
  assert.deepEqual([old, oldDone, newer, decision].map((id) => requireItem(db, id).state), ['closed', 'closed', 'open', 'open']);
});

test('include_action also closes old decisions; answered items and other sessions items are never touched', async (t) => {
  const { db, arch, call, raise } = setup(t);
  const decision = raise('signoff', 500);
  const answered = raise('info', 500);
  answerItem(db, answered, 'ok');
  const theirs = raise('info', 500, arch.id);
  const result = await call({ older_than_minutes: 60, include_action: true });
  assert.deepEqual(result, { count: 1, information: [], action: [decision] });
  assert.deepEqual([answered, theirs].map((id) => requireItem(db, id).state), ['answered', 'open']);
});

test('clear_items refuses minutes under 1 and callers that are not the front desk', async (t) => {
  const { arch, ctx, call } = setup(t);
  await assert.rejects(call({ older_than_minutes: 0 }));
  ctx.identity = { sessionId: arch.id, role: 'architect' };
  await assert.rejects(call({ older_than_minutes: 60 }), /Only the front desk/);
});
