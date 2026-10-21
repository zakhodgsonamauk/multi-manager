import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { claudeArgs, type Command, type LaunchSpec } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import type { ActivityReaders } from '../src/monitor/activity.ts';
import { unresolvedDeaths } from '../src/monitor/health.ts';
import { refreshConversationIds } from '../src/monitor/monitor.ts';
import type { ProcessInfo } from '../src/monitor/processes.ts';
import { openRoster, SCHEMA } from '../src/roster/db.ts';
import { listItems } from '../src/roster/items.ts';
import { startPause } from '../src/roster/pause.ts';
import { addProject } from '../src/roster/projects.ts';
import { registerSession, requireSession, setClaudeSessionId, startFrontDesk } from '../src/roster/sessions.ts';
import { registerRecoveryTools } from '../src/roster/tools-recovery.ts';
import type { ToolContext } from '../src/roster/tools.ts';
import { tempDir, tempRoster } from './helpers.ts';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** The claude arguments inside the wrapper script that wt.exe is given (last argument, base64). */
function claudeArgsOf(command: Command): string[] {
  const line = decodeCommand(command.args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  return [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

/** Nothing real is launched or killed: pids count up, every process is "dead" to the ownership checks. */
function fakeDeps(options: { conversations?: Set<string> | 'all' } = {}) {
  const runs: Command[] = [];
  let nextPid = 4000;
  const deps: LaunchDeps = {
    run: async (command) => {
      runs.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: () => {},
    waitForPid: async () => (nextPid += 1),
    findPid: async () => null,
    ownsProcess: async () => false,
    waitForWrapperPid: async () => (nextPid += 1),
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
    readClaudeSessionId: (pid) => `conv-${pid}`,
    conversationExists: (id) => options.conversations === undefined || options.conversations === 'all' || options.conversations.has(id),
  };
  return { deps, runs };
}

const readers: ActivityReaders = { readSessionFile: () => null, findTranscript: () => null, mtimeMs: () => null };
/** After a reboot: none of our pids exist, only an unrelated process. */
const afterReboot = async (): Promise<ProcessInfo[]> => [{ pid: 1, ppid: 0, name: 'System', created: 0, commandLine: null }];

function setup(t: TestContext, options: { conversations?: Set<string> | 'all' } = {}) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha' });
  addProject(db, { name: 'beta', folder: 'C:\\work\\beta' });
  const fake = fakeDeps(options);
  const launch: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const ctx: ToolContext = { db, identity: { sessionId: desk.id, role: 'front-desk' }, pluginRoot: 'I:\\mm', launch };
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler) } as unknown as McpServer;
  registerRecoveryTools(server, ctx, { snapshot: afterReboot, readers });
  const as = (sessionId: number) => {
    ctx.identity = { sessionId, role: requireSession(db, sessionId).role };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return JSON.parse(text);
  };
  return { db, desk, launch, ctx, fake, as, call };
}

test('an old roster without sessions.claude_session_id gains it on open', (t) => {
  const path = join(tempDir(t), 'roster.db');
  const old = new DatabaseSync(path);
  old.exec(SCHEMA.replace('  wrapper_pid INTEGER,\n', '').replace('  claude_session_id TEXT,\n', ''));
  old.exec("INSERT INTO sessions (role, state, created_at) VALUES ('architect', 'running', 'x')");
  old.close();
  const db = openRoster(path);
  try {
    const columns = db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name);
    assert.ok(columns.includes('claude_session_id'));
    assert.ok(columns.includes('wrapper_pid'));
    assert.equal(db.prepare('SELECT claude_session_id FROM sessions').get()?.claude_session_id, null);
  } finally {
    db.close();
  }
});

test('launch remembers the conversation id; the monitor fills in a missing one and ignores a reused pid', async (t) => {
  const { db, desk, launch } = setup(t);
  const { session } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  assert.equal(session.claude_session_id, `conv-${session.pid}`);

  setClaudeSessionId(db, session.id, null);
  const files: Record<number, unknown> = { [session.pid as number]: { sessionId: 'abc-123', name: session.name } };
  const fill: ActivityReaders = { ...readers, readSessionFile: (pid) => files[pid] ?? null };
  assert.equal(refreshConversationIds(db, fill), 1);
  assert.equal(requireSession(db, session.id).claude_session_id, 'abc-123');
  assert.equal(refreshConversationIds(db, fill), 0);

  files[session.pid as number] = { sessionId: 'someone-else', name: 'mm-other' };
  assert.equal(refreshConversationIds(db, fill), 0);
  assert.equal(requireSession(db, session.id).claude_session_id, 'abc-123');
});

test('claudeArgs puts --resume <id> before -n and keeps settings, briefing and plugin dir', () => {
  const spec = {
    name: 'mm-a-main',
    skipPermissions: true,
    pluginDir: 'I:\\mm',
    briefingFile: 'I:\\mm\\briefings\\architect.md',
    settingsPath: 'C:\\s.json',
    prompt: 'hi',
    resumeId: 'abc',
  } as LaunchSpec;
  assert.deepEqual(claudeArgs(spec).slice(0, 4), ['--resume', 'abc', '-n', 'mm-a-main']);
  assert.ok(claudeArgs(spec).includes('--append-system-prompt-file'));
  assert.deepEqual(claudeArgs({ ...spec, resumeId: undefined }).slice(0, 2), ['-n', 'mm-a-main']);
});

test('after a reboot every architect is restorable with its developers listed under it', async (t) => {
  const { db, desk, launch, fake, call } = setup(t);
  const alpha = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  const dev = (await launchDeveloper(launch, { architectId: alpha.id, task: 'Build login', label: 'login' })).session;
  const beta = (await launchArchitect(launch, { project: 'beta', parentId: desk.id })).session;

  const launched = fake.runs.length;
  const result = await call('restorable_sessions');
  assert.equal(fake.runs.length, launched, 'listing never restarts anything');
  assert.deepEqual(result.architects.map((a: { session_id: number }) => a.session_id), [alpha.id, beta.id]);
  const a = result.architects[0];
  assert.equal(a.project, 'alpha');
  assert.equal(a.workstream, 'main');
  assert.equal(a.conversation_id_present, true);
  assert.ok(typeof a.last_activity === 'string');
  assert.ok(typeof a.died_at === 'string');
  assert.deepEqual(a.developers.map((d: { session_id: number }) => d.session_id), [dev.id]);
  assert.deepEqual(result.architects[1].developers, []);
  assert.equal(requireSession(db, alpha.id).state, 'stopped');
  assert.equal(listItems(db, { addressedTo: desk.id, states: ['open'] }).filter((i) => i.kind === 'blocked').length, 3);
});

test('restart_architect resumes the saved conversation under the same roster id and closes its death item', async (t) => {
  const { db, desk, launch, fake, call } = setup(t);
  const alpha = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  await call('restorable_sessions');
  const conversation = alpha.claude_session_id;
  const restarted = await call('restart_architect', { session_id: alpha.id });
  assert.equal(restarted.session_id, alpha.id);
  assert.equal(restarted.resumed, true);
  const args = claudeArgsOf(fake.runs.at(-1)!);
  assert.deepEqual(args.slice(0, 4), ['--resume', conversation, '-n', 'mm-alpha-main']);
  assert.ok(args.includes('--plugin-dir') && args.includes('--settings') && args.includes('--append-system-prompt-file'));
  assert.match(args.at(-1) ?? '', /^You were restarted after .*Re-read your progress log, check_in, list_items.*WAIT for the user's go/);
  assert.doesNotMatch(args.at(-1) ?? '', /could not be restored/);
  const after = requireSession(db, alpha.id);
  assert.equal(after.state, 'running');
  assert.notEqual(after.pid, alpha.pid);
  assert.deepEqual(listItems(db, { addressedTo: desk.id, states: ['open'] }), []);
  assert.deepEqual(unresolvedDeaths(db), []);
});

test('without a conversation id (or with its file gone) the restart is a fresh launch that says so', async (t) => {
  const { db, desk, launch, fake, call } = setup(t, { conversations: new Set() });
  const alpha = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  const beta = (await launchArchitect(launch, { project: 'beta', parentId: desk.id })).session;
  setClaudeSessionId(db, alpha.id, null);
  await call('restorable_sessions');
  for (const id of [alpha.id, beta.id]) {
    const restarted = await call('restart_architect', { session_id: id, reason: 'a crash' });
    assert.equal(restarted.resumed, false);
    assert.match(restarted.warnings.join('\n'), /fresh conversation/);
    const args = claudeArgsOf(fake.runs.at(-1)!);
    assert.ok(!args.includes('--resume'));
    assert.equal(args[0], '-n');
    assert.match(args.at(-1) ?? '', /^You are the Multi-Manager architect for project \w+, workstream main\. You were restarted after a crash\. Your earlier conversation could not be restored\./);
  }
});

test('restore_all restarts architects but not their developers', async (t) => {
  const { desk, launch, fake, call } = setup(t);
  const alpha = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  const dev = (await launchDeveloper(launch, { architectId: alpha.id, task: 'Build login', label: 'login' })).session;
  await launchArchitect(launch, { project: 'beta', parentId: desk.id });
  const before = fake.runs.length;
  const result = await call('restore_all');
  assert.deepEqual(result.restored.map((r: { name: string }) => r.name), ['mm-alpha-main', 'mm-beta-main']);
  assert.deepEqual(result.developers_not_restarted.map((d: { session_id: number }) => d.session_id), [dev.id]);
  assert.equal(fake.runs.length, before + 2);
  assert.ok(fake.runs.slice(before).every((c) => !claudeArgsOf(c).includes('--worktree')));
});

test('recovery tools are front desk only', async (t) => {
  const { db, desk, launch, as, call } = setup(t);
  const alpha = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  as(alpha.id);
  await assert.rejects(call('restorable_sessions'), /Only the front desk can call restorable_sessions/);
  await assert.rejects(call('restart_architect', { session_id: alpha.id }), /Only the front desk can call restart_architect/);
  await assert.rejects(call('restore_all'), /Only the front desk can call restore_all/);
  const dev = registerSession(db, { role: 'developer', parentId: alpha.id, projectId: alpha.project_id, workstreamId: alpha.workstream_id, name: 'd' });
  as(desk.id);
  await assert.rejects(call('restart_architect', { session_id: dev.id }), /is not an architect/);
});

test('restarts are refused while paused; restore_all skips a paused project', async (t) => {
  const { db, desk, launch, fake, call } = setup(t);
  const alpha = (await launchArchitect(launch, { project: 'alpha', parentId: desk.id })).session;
  await launchArchitect(launch, { project: 'beta', parentId: desk.id });
  await call('restorable_sessions');
  const before = fake.runs.length;
  const projectPause = startPause(db, { projectId: alpha.project_id });
  await assert.rejects(call('restart_architect', { session_id: alpha.id }), /paused/);
  const partial = await call('restore_all');
  assert.deepEqual(partial.restored.map((r: { name: string }) => r.name), ['mm-beta-main']);
  assert.deepEqual(partial.skipped.map((s: { why: string }) => s.why), ['alpha is paused']);
  assert.ok(projectPause.pause.id > 0);
  startPause(db, { projectId: null });
  await assert.rejects(call('restore_all'), /everything is paused/);
  assert.equal(fake.runs.length, before + 1);
  assert.equal(requireSession(db, alpha.id).state, 'stopped');
});
