import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FRONT_DESK_NAME, frontDeskNameFromEnv } from '../src/roster/sessions.ts';
import { tempDir } from './helpers.ts';

const serverPath = join(import.meta.dirname, '..', 'src', 'roster', 'server.ts');
const CLUSTER_DESK = 'mm-front-desk-team-alpha-one';

test('frontDeskNameFromEnv: MM_FRONT_DESK_NAME when set, mm-front-desk otherwise', () => {
  assert.equal(FRONT_DESK_NAME, 'mm-front-desk');
  assert.equal(frontDeskNameFromEnv({ MM_FRONT_DESK_NAME: CLUSTER_DESK }), CLUSTER_DESK);
  assert.equal(frontDeskNameFromEnv({}), 'mm-front-desk');
  assert.equal(frontDeskNameFromEnv({ MM_FRONT_DESK_NAME: '  ' }), 'mm-front-desk', 'a blank value counts as unset');
});

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content.map((c) => c.text).join('\n');
}

/**
 * Runs a roster server in a temp folder with the given MM_FRONT_DESK_NAME (or none) and no other MM_ variable,
 * calls start_front_desk, then raises an item to the front desk: returns the name it was given and the name
 * that item's nudge would message.
 */
async function deskAndNudge(t: TestContext, deskName: string | undefined, args: Record<string, unknown> = {}) {
  const dir = tempDir(t);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('MM_')) env[key] = value;
  env.MM_ROSTER_DB = join(dir, 'roster.db');
  env.LOCALAPPDATA = dir; // start_front_desk installs the Terminal fragment here, not in the real profile
  if (deskName !== undefined) env.MM_FRONT_DESK_NAME = deskName;
  const client = new Client({ name: 'front-desk-name-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'pipe' }));
  // Closed here, not in t.after: the temp folder's clean-up runs first there and the open roster blocks it.
  try {
    const call = async (name: string, a: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: a });
      assert.notEqual(result.isError, true, text(result));
      return text(result);
    };
    const started = await call('start_front_desk', args);
    const you = /## You are roster session #(\d+) \(([^)]+)\)/.exec(started);
    assert.ok(you, started);
    const raised = JSON.parse(await call('raise_item', { kind: 'info', body: 'hello', addressed_to: Number(you[1]) })) as {
      nudge: { to: string | null };
    };
    return { shown: you[2], nudgeTo: raised.nudge.to };
  } finally {
    await client.close();
  }
}

test('start_front_desk with no name uses MM_FRONT_DESK_NAME, and a nudge to the front desk names it', async (t) => {
  assert.deepEqual(await deskAndNudge(t, CLUSTER_DESK), { shown: CLUSTER_DESK, nudgeTo: CLUSTER_DESK });
});

test('start_front_desk with no name and no MM_FRONT_DESK_NAME uses mm-front-desk', async (t) => {
  assert.deepEqual(await deskAndNudge(t, undefined), { shown: 'mm-front-desk', nudgeTo: 'mm-front-desk' });
});

test('an explicit name still wins over MM_FRONT_DESK_NAME', async (t) => {
  assert.deepEqual(await deskAndNudge(t, CLUSTER_DESK, { name: 'mm-desk-by-hand' }), { shown: 'mm-desk-by-hand', nudgeTo: 'mm-desk-by-hand' });
});
