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

test('.mcp.json starts the roster server with node from the plugin root', () => {
  const servers = json('.mcp.json').mcpServers as Record<string, { command: string; args: string[] }>;
  assert.deepEqual(servers.roster, { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/roster/server.ts'] });
});

test('every user command exists, has a description and names its roster tool', () => {
  const commands: Record<string, string> = {
    'front-desk': 'start_front_desk',
    'add-project': 'add_project',
    status: 'status',
    'start-architect': 'launch_architect',
    'stop-architect': 'stop_architect',
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

test('the architect workflow commands exist, with frontmatter, and name their key steps', () => {
  const commands: Record<string, string[]> = {
    'plan-goal': ['`allocate_number` kind `task`', 'templates/architect/', 'helper agents', 'kind `signoff`', 'testing approach', 'docs/multi-manager/'],
    dispatch: ['`launch_developer`', 'task file', 'One task = one branch = one worktree = one developer tab', '`paused`'],
    'review-return': ['helper agent', 'git merge --squash', 'untracked file', 'focused tests', 'Send-back round N', '`restart_developer`', '`stop_developer`'],
    'wrap-goal': ['`status.md`', 'kind `done`', 'evidence', '`update_goal`', '`report_spend`'],
  };
  for (const [name, words] of Object.entries(commands)) {
    const path = join(root, 'commands', `${name}.md`);
    assert.ok(existsSync(path), `missing commands/${name}.md`);
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^---\ndescription: .+\nargument-hint: .+\n---\n/, `${name}.md needs description and argument-hint frontmatter`);
    assert.ok(text.includes('$ARGUMENTS'), `${name}.md should pass $ARGUMENTS`);
    for (const word of words) assert.ok(text.includes(word), `${name}.md should mention ${word}`);
  }
});

test('the architect templates exist', () => {
  for (const name of ['status', 'task', 'return', 'decisions', 'progress']) {
    const path = join(root, 'templates', 'architect', `${name}.md`);
    assert.ok(existsSync(path), `missing templates/architect/${name}.md`);
    assert.match(readFileSync(path, 'utf8'), /^# /, `templates/architect/${name}.md needs a heading`);
  }
  const task = readFileSync(join(root, 'templates', 'architect', 'task.md'), 'utf8');
  for (const section of ['## Goal', '## Tests first', '## Files expected to change', '## Out of scope', '## Test scope', 'Send-back round']) {
    assert.ok(task.includes(section), `task.md template should have ${section}`);
  }
  assert.match(readFileSync(join(root, 'templates', 'architect', 'progress.md'), 'utf8'), /Tick job id/);
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
