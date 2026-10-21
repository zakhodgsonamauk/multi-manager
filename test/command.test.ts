import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  architectPrompt,
  buildLaunchCommand,
  buildStopCommand,
  developerPrompt,
  escapeForWt,
  sessionName,
  type LaunchSpec,
} from '../src/launch/command.ts';

const base: LaunchSpec = {
  wtPath: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
  name: 'mm-alpha-main',
  folder: 'C:\\work\\alpha project',
  role: 'architect',
  skipPermissions: true,
  briefingFile: 'I:\\Dropbox (Personal)\\mm\\briefings\\architect.md',
  pluginDir: 'I:\\Dropbox (Personal)\\mm',
  settingsPath: 'C:\\Users\\me\\.claude\\multi-manager\\sessions\\7.settings.json',
  prompt: 'You are the architect. Start with goal #3.',
  sessionId: 7,
  parentId: 1,
  rosterDb: 'C:\\Users\\me\\.claude\\multi-manager\\roster.db',
};

test('architect launch: exact wt.exe arguments with skipped permissions', () => {
  const command = buildLaunchCommand(base);
  assert.equal(command.file, base.wtPath);
  assert.deepEqual(command.args, [
    '-w', 'multi-manager', 'new-tab', '--profile', 'Multi-Manager', '--title', 'mm-alpha-main', '-d', 'C:\\work\\alpha project',
    'claude', '-n', 'mm-alpha-main', '--dangerously-skip-permissions',
    '--plugin-dir', 'I:\\Dropbox (Personal)\\mm',
    '--append-system-prompt-file', 'I:\\Dropbox (Personal)\\mm\\briefings\\architect.md',
    '--settings', 'C:\\Users\\me\\.claude\\multi-manager\\sessions\\7.settings.json',
    'You are the architect. Start with goal #3.',
  ]);
});

test('architect launch without skipped permissions omits only that flag', () => {
  const skipped = buildLaunchCommand(base).args;
  const prompted = buildLaunchCommand({ ...base, skipPermissions: false }).args;
  assert.ok(!prompted.includes('--dangerously-skip-permissions'));
  assert.deepEqual(prompted, skipped.filter((arg) => arg !== '--dangerously-skip-permissions'));
});

test('the session env goes into the --settings file', () => {
  const command = buildLaunchCommand(base);
  assert.equal(command.settings.path, base.settingsPath);
  assert.deepEqual(JSON.parse(command.settings.content), {
    env: { MM_ROLE: 'architect', MM_SESSION_ID: '7', MM_PARENT_ID: '1', MM_ROSTER_DB: base.rosterDb, MM_VOICE: 'off' },
  });
});

test('no parent means no MM_PARENT_ID', () => {
  const env = JSON.parse(buildLaunchCommand({ ...base, parentId: null }).settings.content).env;
  assert.equal(env.MM_PARENT_ID, undefined);
});

test('developer sessions get the developer role and their own worktree', () => {
  const command = buildLaunchCommand({ ...base, role: 'developer', name: 'mm-alpha-main-dev-login', worktree: 'mm-alpha-main-dev-login' });
  const at = command.args.indexOf('--worktree');
  assert.ok(at > command.args.indexOf('claude'));
  assert.equal(command.args[at + 1], 'mm-alpha-main-dev-login');
  assert.equal(JSON.parse(command.settings.content).env.MM_ROLE, 'developer');
});

test('semicolons are escaped so wt.exe does not split the command', () => {
  assert.equal(escapeForWt('a; b;c'), 'a\\; b\\;c');
  const command = buildLaunchCommand({ ...base, prompt: 'Plan it; then build', folder: 'C:\\odd;folder' });
  assert.equal(command.args.at(-1), 'Plan it\\; then build');
  assert.equal(command.args[command.args.indexOf('-d') + 1], 'C:\\odd\\;folder');
});

test('session names are lower-case slugs', () => {
  assert.equal(sessionName('My App', 'main'), 'mm-my-app-main');
  assert.equal(sessionName('alpha', 'main', 'dev', 'Login Form!'), 'mm-alpha-main-dev-login-form');
});

test('stop kills the whole process tree', () => {
  assert.deepEqual(buildStopCommand(4242), { file: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
  assert.throws(() => buildStopCommand(0), /Invalid process id/);
});

test('initial prompts name the roster goal or session and contain no semicolons', () => {
  assert.match(architectPrompt('alpha', 'main', 3), /roster goal #3/);
  assert.match(architectPrompt('alpha', 'main'), /No goal yet/);
  assert.match(developerPrompt('alpha', 'main', 'Build the login form', 12), /roster session #12/);
  for (const prompt of [architectPrompt('a', 'b', 1), architectPrompt('a', 'b'), developerPrompt('a', 'b', 'x', 1)]) {
    assert.ok(!prompt.includes(';'));
  }
});
