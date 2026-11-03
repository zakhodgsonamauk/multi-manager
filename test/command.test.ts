import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  architectPrompt,
  buildLaunchCommand,
  buildStopCommand,
  claudeArgs,
  developerPrompt,
  escapeForWt,
  modelChangePrompt,
  sessionName,
  type LaunchSpec,
} from '../src/launch/command.ts';
import { buildWrapperScript, decodeCommand } from '../src/launch/wrapper.ts';

const base: LaunchSpec = {
  wtPath: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
  name: 'mm-alpha-main',
  folder: 'C:\\work\\alpha project',
  role: 'architect',
  skipPermissions: true,
  briefingFile: 'C:\\tools\\mm\\briefings\\architect.md',
  pluginDir: 'C:\\tools\\mm',
  settingsPath: 'C:\\Users\\me\\.claude\\multi-manager\\sessions\\7.settings.json',
  prompt: 'You are the architect. Start with goal #3.',
  sessionId: 7,
  parentId: 1,
  rosterDb: 'C:\\Users\\me\\.claude\\multi-manager\\roster.db',
};

test('architect launch: wt.exe opens a pwsh tab with the wrapper as an encoded command', () => {
  const command = buildLaunchCommand(base);
  assert.equal(command.file, base.wtPath);
  assert.deepEqual(command.args.slice(0, -1), [
    '-w', 'multi-manager', 'new-tab', '--profile', 'Multi-Manager', '--title', 'mm-alpha-main', '-d', 'C:\\work\\alpha project',
    'pwsh', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
  ]);
  assert.match(command.args.at(-1) ?? '', /^[A-Za-z0-9+/]+=*$/);
  assert.equal(
    decodeCommand(command.args.at(-1) ?? ''),
    buildWrapperScript({
      sessionId: 7,
      rosterDb: base.rosterDb,
      stateDir: 'C:\\Users\\me\\.claude\\multi-manager\\sessions',
      folder: base.folder,
      claudeArgs: claudeArgs(base),
    }),
  );
});

test('claude arguments: exact, with skipped permissions', () => {
  assert.deepEqual(claudeArgs(base), [
    '-n', 'mm-alpha-main', '--dangerously-skip-permissions',
    '--plugin-dir', 'C:\\tools\\mm',
    '--append-system-prompt-file', 'C:\\tools\\mm\\briefings\\architect.md',
    '--settings', 'C:\\Users\\me\\.claude\\multi-manager\\sessions\\7.settings.json',
    'You are the architect. Start with goal #3.',
  ]);
});

test('architect launch without skipped permissions omits only that flag', () => {
  const skipped = claudeArgs(base);
  const prompted = claudeArgs({ ...base, skipPermissions: false });
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

test('developer sessions get the developer role and never a --worktree flag', () => {
  const spec: LaunchSpec = { ...base, role: 'developer', name: 'mm-alpha-main-dev-login' };
  assert.ok(!claudeArgs(spec).includes('--worktree'));
  assert.equal(JSON.parse(buildLaunchCommand(spec).settings.content).env.MM_ROLE, 'developer');
});

test('developer sessions run git with long paths on, so a copy deep under .claude/worktrees works; architects do not', () => {
  const dev = JSON.parse(buildLaunchCommand({ ...base, role: 'developer', name: 'mm-alpha-main-dev-login' }).settings.content).env;
  assert.equal(dev.GIT_CONFIG_COUNT, '1');
  assert.equal(dev.GIT_CONFIG_KEY_0, 'core.longpaths');
  assert.equal(dev.GIT_CONFIG_VALUE_0, 'true');
  const arch = JSON.parse(buildLaunchCommand(base).settings.content).env;
  assert.equal(arch.GIT_CONFIG_COUNT, undefined);
});

test('a process cap reaches the wrapper script', () => {
  const script = decodeCommand(buildLaunchCommand({ ...base, maxProcesses: 40 }).args.at(-1) ?? '');
  assert.match(script, /\[MmKillOnCloseJob\]::Enable\(40\)/);
  assert.match(decodeCommand(buildLaunchCommand(base).args.at(-1) ?? ''), /\[MmKillOnCloseJob\]::Enable\(0\)/);
});

test('semicolons are escaped for wt.exe; the prompt travels unescaped inside the base64', () => {
  assert.equal(escapeForWt('a; b;c'), 'a\\; b\\;c');
  const command = buildLaunchCommand({ ...base, prompt: 'Plan it; then build', folder: 'C:\\odd;folder' });
  assert.equal(command.args[command.args.indexOf('-d') + 1], 'C:\\odd\\;folder');
  assert.ok(command.args.every((arg) => !/(^|[^\\]);/.test(arg)));
  const script = decodeCommand(command.args.at(-1) ?? '');
  assert.ok(script.includes("'Plan it; then build'"));
  assert.ok(script.includes("Set-Location -LiteralPath 'C:\\odd;folder'"));
});

test('session names are lower-case slugs', () => {
  assert.equal(sessionName('My App', 'main'), 'mm-my-app-main');
  assert.equal(sessionName('alpha', 'main', 'dev', 'Login Form!'), 'mm-alpha-main-dev-login-form');
});

test('stop kills the whole process tree', () => {
  assert.deepEqual(buildStopCommand(4242), { file: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
  assert.throws(() => buildStopCommand(0), /Invalid process id/);
});

test('a model reaches claude as --model, after the session name', () => {
  const args = claudeArgs({ ...base, model: 'sonnet' });
  assert.deepEqual(args.slice(0, 4), ['-n', 'mm-alpha-main', '--model', 'sonnet']);
});

test('no model means no --model flag (existing launches are unchanged)', () => {
  assert.ok(!claudeArgs(base).includes('--model'));
});

test('a resume launch keeps --resume before -n and still carries --model', () => {
  const args = claudeArgs({ ...base, model: 'opus', resumeId: 'abc-123' });
  assert.deepEqual(args.slice(0, 6), ['--resume', 'abc-123', '-n', 'mm-alpha-main', '--model', 'opus']);
});

test('modelChangePrompt names the new model and, when restored, says the conversation was kept', () => {
  const restored = modelChangePrompt('developer', 'opus', true);
  assert.match(restored, /model was changed to opus/);
  assert.match(restored, /conversation was preserved/);
});

test('modelChangePrompt: a developer carries on with its task, an architect waits for the go', () => {
  const developer = modelChangePrompt('developer', 'opus', true);
  assert.match(developer, /continue your task where you stopped/);
  assert.doesNotMatch(developer, /WAIT/);
  const architect = modelChangePrompt('architect', 'opus', false);
  assert.match(architect, /could not be restored/);
  assert.match(architect, /WAIT for the user's go/);
});

test('initial prompts name the roster goal or session and contain no semicolons', () => {
  assert.match(architectPrompt('alpha', 'main', 3), /roster goal #3/);
  assert.match(architectPrompt('alpha', 'main'), /No goal yet/);
  assert.match(developerPrompt('alpha', 'main', 'Build the login form', 12), /roster session #12/);
  for (const prompt of [architectPrompt('a', 'b', 1), architectPrompt('a', 'b'), developerPrompt('a', 'b', 'x', 1)]) {
    assert.ok(!prompt.includes(';'));
  }
});

test('a tool-connection file goes in as --mcp-config followed by another option, with the prompt still last, never --strict-mcp-config', () => {
  const args = claudeArgs({ ...base, mcpConfigPath: 'C:/s/7.mcp.json' });
  assert.equal(args[args.indexOf('--mcp-config') + 1], 'C:/s/7.mcp.json');
  // --mcp-config takes several values: the next argument after the path must be an option, not the prompt.
  assert.ok(args[args.indexOf('--mcp-config') + 2].startsWith('--'));
  assert.equal(args.at(-1), base.prompt);
  assert.ok(!args.includes('--strict-mcp-config'));
});

test('without a tool-connection file the arguments are unchanged and no extra file is returned', () => {
  assert.ok(!claudeArgs(base).includes('--mcp-config'));
  assert.equal(buildLaunchCommand(base).mcpConfig, undefined);
});

test('buildLaunchCommand returns the tool-connection file to write', () => {
  const command = buildLaunchCommand({ ...base, mcpConfigPath: 'C:/s/7.mcp.json', mcpConfigContent: '{}\n' });
  assert.deepEqual(command.mcpConfig, { path: 'C:/s/7.mcp.json', content: '{}\n' });
});
