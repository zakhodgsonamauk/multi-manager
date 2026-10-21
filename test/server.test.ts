import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tempDir } from './helpers.ts';

const serverPath = join(import.meta.dirname, '..', 'src', 'roster', 'server.ts');

const ALL_TOOLS = [
  'add_project', 'add_workstream', 'allocate_number', 'answer_item', 'check_in', 'claim', 'close_item', 'create_goal',
  'finish_pause', 'get_briefing', 'get_goal', 'get_limits', 'launch_architect', 'launch_developer', 'list_items',
  'list_projects', 'list_sessions', 'list_workstreams', 'mark_seen', 'monitor_tick', 'pause', 'pause_status',
  'raise_item', 'record_nudge', 'register_session', 'release', 'report_paused', 'report_spend', 'resources', 'restart_developer',
  'resume', 'set_limits', 'set_voice', 'start_front_desk', 'status', 'stop_architect', 'stop_developer', 'team_health', 'update_goal',
  'voice_status',
];

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content.map((c) => c.text).join('\n');
}

test('the roster MCP server exposes every tool and round-trips a verbatim answer', async (t) => {
  const dir = tempDir(t);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('MM_')) env[key] = value;
  env.MM_ROSTER_DB = join(dir, 'roster.db');
  env.LOCALAPPDATA = dir; // start_front_desk installs the Terminal fragment here, not in the real profile
  const client = new Client({ name: 'roster-smoke-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'pipe' }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ALL_TOOLS);

    const early = await client.callTool({ name: 'check_in', arguments: {} });
    assert.equal(early.isError, true);
    assert.match(text(early), /not registered with the roster/);

    assert.match(text(await client.callTool({ name: 'start_front_desk', arguments: {} })), /# Multi-Manager: Front desk/);
    await client.callTool({ name: 'add_project', arguments: { name: 'smoke', folder: dir } });
    const raised = JSON.parse(text(await client.callTool({ name: 'raise_item', arguments: { kind: 'question', body: 'Ship it?' } }))) as {
      item: { id: number };
    };
    const words = 'Yes — but only after the e2e run; thanks.';
    const answered = JSON.parse(text(await client.callTool({ name: 'answer_item', arguments: { item_id: raised.item.id, answer: words } }))) as {
      item: { answer: string };
    };
    assert.equal(answered.item.answer, words);

    const status = JSON.parse(text(await client.callTool({ name: 'status', arguments: {} }))) as { projects: { name: string }[] };
    assert.deepEqual(status.projects.map((p) => p.name), ['smoke']);
  } finally {
    await client.close();
  }
});
