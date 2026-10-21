import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');
const json = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;

test('plugin.json names the multi-manager plugin', () => {
  const manifest = json('.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'multi-manager');
  assert.match(String(manifest.version), /^\d+\.\d+\.\d+$/);
  assert.ok(String(manifest.description).length > 20);
});

test('plugin.json starts the roster server with node from the plugin root', () => {
  const servers = json('.claude-plugin/plugin.json').mcpServers as Record<string, { command: string; args: string[] }>;
  assert.deepEqual(servers.roster, { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/roster/server.ts'] });
});

test('no .mcp.json at the repo root: it would load as a project MCP config in any session opened here', () => {
  assert.ok(!existsSync(join(root, '.mcp.json')));
});

test('plugin.json names the pane mod\'s state contract', () => {
  const manifest = json('.claude-plugin/plugin.json');
  assert.equal(manifest.types, './types/index.d.ts');
  assert.ok(existsSync(join(root, 'types', 'index.d.ts')));
});

test('every user command exists, has a description and names its roster tool', () => {
  const commands: Record<string, string> = {
    'front-desk': 'start_front_desk',
    'add-project': 'add_project',
    status: 'status',
    'start-architect': 'launch_architect',
    'stop-architect': 'stop_architect',
    // The mod answers /multi-manager:pane itself; the markdown is the fallback where mods are off.
    pane: 'status',
  };
  for (const [name, tool] of Object.entries(commands)) {
    const path = join(root, 'commands', `${name}.md`);
    assert.ok(existsSync(path), `missing commands/${name}.md`);
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^---\ndescription: .+\n/, `${name}.md needs a description`);
    assert.ok(text.includes(`\`${tool}\``), `${name}.md should name \`${tool}\``);
  }
  assert.match(readFileSync(join(root, 'commands', 'front-desk.md'), 'utf8'), /--dangerously-skip-permissions/);
});

test('commands/tick.md is the role-aware check-in tick', () => {
  const path = join(root, 'commands', 'tick.md');
  assert.ok(existsSync(path), 'missing commands/tick.md');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^---\ndescription: .+\n(argument-hint: .+\n)?---\n/);
  for (const word of ['`team_health`', '`paused`', 'paused — tick skipped', '`record_nudge`', '`restart_developer`', '`check_in`', '`raise_item`', '`stop_architect`', 'all quiet', 'MM_ROLE']) {
    assert.ok(text.includes(word), `tick.md should mention ${word}`);
  }
  assert.ok(text.indexOf('`team_health`') < text.indexOf('`check_in`'), 'team_health must come first');
});
