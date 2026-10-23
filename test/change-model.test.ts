import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Command } from '../src/launch/command.ts';
import { cwdWithin } from '../src/launch/process.ts';
import { changeSessionModel, launchArchitect, launchDeveloper, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { decodeCommand } from '../src/launch/wrapper.ts';
import { claim, listClaims } from '../src/roster/claims.ts';
import { listModelUsage } from '../src/roster/model-ledger.ts';
import { startPause } from '../src/roster/pause.ts';
import { addProject, getProjectDefaultModel } from '../src/roster/projects.ts';
import { registerSession, requireSession, setClaudeSessionId, setSessionPid, setSessionState, startFrontDesk } from '../src/roster/sessions.ts';
import { registerRosterTools, type ToolContext } from '../src/roster/tools.ts';
import { tempRoster } from './helpers.ts';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const CONVERSATION = '0f1e2d3c-aaaa-bbbb-cccc-123456789abc';

/** The claude arguments inside the wrapper script that wt.exe is given (last argument, base64). */
function claudeArgsOf(command: Command): string[] {
  const line = decodeCommand(command.args.at(-1) ?? '').split('\n').find((l) => l.startsWith('& claude ')) ?? '';
  return [...line.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

function after(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

/** Nothing real is launched or killed. Each launch gets a new pid; the conversation id is fixed unless told otherwise. */
function fakeDeps(options: { conversationExists: boolean }) {
  const runs: Command[] = [];
  const killed: number[] = [];
  let nextPid = 4000;
  const deps: LaunchDeps = {
    run: async (command) => {
      runs.push(command);
      if (command.file === 'taskkill') killed.push(Number(command.args[1]));
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: () => {},
    waitForPid: async () => (nextPid += 1),
    findPid: async () => null,
    ownsProcess: async () => true,
    waitForWrapperPid: async () => null,
    readWrapperPid: () => null,
    ownsWrapper: async () => false,
    removeFiles: () => {},
    ensureTerminalProfile: () => {},
    readClaudeSessionId: () => CONVERSATION,
    conversationExists: () => options.conversationExists,
  };
  return { deps, runs, killed };
}

/** A temp roster (closed and deleted after the test) with a front desk, a running architect and its running developer. */
async function setup(t: TestContext, options: { conversationExists: boolean } = { conversationExists: true }) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha' });
  addProject(db, { name: 'beta', folder: 'C:\\work\\beta' });
  const fake = fakeDeps(options);
  const launch: LaunchContext = { db, deps: fake.deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  const { session: architect } = await launchArchitect(launch, { project: 'alpha', parentId: desk.id });
  const { session: developer } = await launchDeveloper(launch, {
    architectId: architect.id,
    task: 'build the login form',
    label: 'login',
    complexity: 2,
    clarity: 4,
  });
  return { db, desk, launch, architect, developer, ...fake };
}

test('stepping a running developer up relaunches it on the new model with its conversation, same roster id', async (t) => {
  const { db, launch, developer, runs, killed } = await setup(t);
  assert.equal(developer.model, 'sonnet');
  const before = runs.length;
  const result = await changeSessionModel(launch, { sessionId: developer.id, model: 'opus' });
  assert.equal(result.relaunched, true);
  assert.equal(result.resumed, true);
  assert.equal(result.session.id, developer.id);
  assert.deepEqual(killed, [developer.pid], 'only its own process is closed');
  const launched = runs.slice(before).filter((c) => c.file !== 'taskkill');
  assert.equal(launched.length, 1);
  const args = claudeArgsOf(launched[0]);
  assert.equal(after(args, '--resume'), CONVERSATION);
  assert.equal(after(args, '--model'), 'opus');
  assert.equal(after(args, '--worktree'), developer.name, 'a developer goes back into its own worktree');
  assert.match(args.at(-1) ?? '', /^Your model was changed to opus\. .*Your earlier conversation was preserved\./);
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model], ['running', 'opus']);
  assert.notEqual(row.pid, developer.pid);
  assert.deepEqual(listModelUsage(db), [], 'the function itself does not write the ledger');
});

test('a tab whose pid and conversation were never recorded is found by name, its conversation read before the close, and resumed', async (t) => {
  const { db, launch, developer, deps, runs, killed } = await setup(t);
  // The launch wait gave up (e.g. a "trust this folder?" prompt held claude back), so nothing was recorded.
  setSessionPid(db, developer.id, null);
  setClaudeSessionId(db, developer.id, null);
  const live = 4999;
  // Its tab runs in its worktree, under the project folder.
  const cwd = `c:/WORK/alpha/.claude/worktrees/${developer.name}`;
  deps.findPid = async (name, within) => (name === developer.name && within !== undefined && cwdWithin(cwd, within) ? live : null);
  deps.readClaudeSessionId = (pid) => (pid === live && !killed.includes(live) ? CONVERSATION : null);
  const before = runs.length;
  const result = await changeSessionModel(launch, { sessionId: developer.id, model: 'opus' });
  assert.deepEqual([result.relaunched, result.resumed], [true, true]);
  assert.deepEqual(killed, [live], 'the process found by name is the one closed');
  assert.ok(!result.warnings.some((w) => /fresh conversation/.test(w)), result.warnings.join('\n'));
  const args = claudeArgsOf(runs.slice(before).find((c) => c.file !== 'taskkill')!);
  assert.equal(after(args, '--resume'), CONVERSATION);
  assert.equal(after(args, '--model'), 'opus');
});

test("a same-named tab in another cluster's folder is neither read nor closed: the model is not changed", async (t) => {
  const { db, launch, developer, deps, runs } = await setup(t);
  setSessionPid(db, developer.id, null);
  setClaudeSessionId(db, developer.id, null);
  const other = 4999;
  // Another cluster also has a project alpha, so its tab has the same name; any lookup without a folder finds it.
  deps.findPid = async (name, within) => (name === developer.name && (within === undefined || cwdWithin('D:\\cluster-b\\alpha', within)) ? other : null);
  const read: number[] = [];
  deps.readClaudeSessionId = (pid) => {
    read.push(pid);
    return CONVERSATION;
  };
  const before = runs.length;
  await assert.rejects(changeSessionModel(launch, { sessionId: developer.id, model: 'opus' }), /could not close mm-alpha-main-dev-login's tab, model not changed/);
  assert.deepEqual(read, [], "the other cluster's conversation is never read");
  assert.equal(runs.length, before, 'nothing killed, nothing launched');
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model, row.claude_session_id], ['running', 'sonnet', null]);
});

test('changing a stopped session records the model and launches nothing', async (t) => {
  const { db, launch, developer, runs } = await setup(t);
  setSessionState(db, developer.id, 'stopped');
  const before = runs.length;
  const result = await changeSessionModel(launch, { sessionId: developer.id, model: 'haiku' });
  assert.deepEqual([result.relaunched, result.resumed], [false, false]);
  assert.equal(runs.length, before);
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model], ['stopped', 'haiku']);
});

test('a developer whose conversation is gone is relaunched fresh with its original task', async (t) => {
  const { db, launch, developer, runs } = await setup(t, { conversationExists: false });
  const before = runs.length;
  const result = await changeSessionModel(launch, { sessionId: developer.id, model: 'opus' });
  assert.deepEqual([result.relaunched, result.resumed], [true, false]);
  assert.match(result.warnings.join('\n'), /fresh conversation/);
  const args = claudeArgsOf(runs.slice(before).find((c) => c.file !== 'taskkill')!);
  assert.ok(!args.includes('--resume'));
  assert.equal(after(args, '--model'), 'opus');
  const prompt = args.at(-1) ?? '';
  assert.match(prompt, new RegExp(`^You are a Multi-Manager developer \\(roster session #${developer.id}\\) for project alpha, workstream main\\. Your task: build the login form`));
  assert.match(prompt, /Your model was changed to opus\..*could not be restored/);
  assert.equal(requireSession(db, developer.id).claude_session_id, CONVERSATION, 'the new launch records its own conversation');
});

test('an architect whose conversation is gone is relaunched fresh with its role prompt', async (t) => {
  const { launch, architect, developer, runs, killed } = await setup(t, { conversationExists: false });
  const before = runs.length;
  const result = await changeSessionModel(launch, { sessionId: architect.id, model: 'opus' });
  assert.deepEqual([result.relaunched, result.resumed], [true, false]);
  assert.deepEqual(killed, [architect.pid], 'its developers are left running');
  assert.notEqual(killed[0], developer.pid);
  const args = claudeArgsOf(runs.slice(before).find((c) => c.file !== 'taskkill')!);
  assert.ok(!args.includes('--resume'));
  assert.ok(!args.includes('--worktree'));
  assert.equal(after(args, '--model'), 'opus');
  assert.match(args.at(-1) ?? '', /^You are the Multi-Manager architect for project alpha, workstream main\..*Your model was changed to opus\./);
});

test('the front desk model is never changed', async (t) => {
  const { launch, desk, runs } = await setup(t);
  const before = runs.length;
  await assert.rejects(changeSessionModel(launch, { sessionId: desk.id, model: 'opus' }), /front desk/);
  assert.equal(runs.length, before);
});

test('a paused project refuses to change a running session: nothing closed or launched', async (t) => {
  const { db, launch, developer, runs } = await setup(t);
  startPause(db, { projectId: developer.project_id });
  const before = runs.length;
  await assert.rejects(changeSessionModel(launch, { sessionId: developer.id, model: 'opus' }), /paused/);
  assert.equal(runs.length, before);
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model], ['running', 'sonnet']);
});

test('when its process is not provably its own, the tab is not relaunched and the model is not changed', async (t) => {
  const { db, launch, developer, deps, runs } = await setup(t);
  deps.ownsProcess = async () => false;
  const before = runs.length;
  await assert.rejects(
    changeSessionModel(launch, { sessionId: developer.id, model: 'opus' }),
    /could not close mm-alpha-main-dev-login's tab, model not changed.*is not mm-alpha-main-dev-login's claude\.exe any more.*stop it \(stop_developer\)/,
  );
  assert.equal(runs.length, before, 'nothing killed, nothing launched');
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model, row.pid], ['running', 'sonnet', developer.pid]);
});

test('when taskkill fails, the tab is not relaunched and the model is not changed', async (t) => {
  const { db, launch, developer, deps, runs } = await setup(t);
  deps.run = async (command) => {
    runs.push(command);
    return { code: command.file === 'taskkill' ? 128 : 0, stdout: '', stderr: 'access denied' };
  };
  const before = runs.length;
  await assert.rejects(changeSessionModel(launch, { sessionId: developer.id, model: 'opus' }), /could not close .*model not changed.*exited with 128/);
  assert.deepEqual(runs.slice(before).map((c) => c.file), ['taskkill'], 'no launch after a failed kill');
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model], ['running', 'sonnet']);
});

test('when the relaunch fails after the kill, the old model stays, claims are released and the error names the restart tool', async (t) => {
  const { db, launch, developer, architect, deps, runs } = await setup(t);
  claim(db, developer.project_id!, 'src/a.ts', developer.id);
  deps.run = async (command) => {
    runs.push(command);
    return command.file === 'taskkill' ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: 'wt broke' };
  };
  await assert.rejects(
    changeSessionModel(launch, { sessionId: developer.id, model: 'opus' }),
    /mm-alpha-main-dev-login's tab was closed but could not be relaunched on opus.*wt broke.*restart_developer/,
  );
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model], ['stopped', 'sonnet']);
  assert.deepEqual(listClaims(db, developer.project_id!), []);

  await assert.rejects(changeSessionModel(launch, { sessionId: architect.id, model: 'opus' }), /restart_architect/);
  assert.equal(requireSession(db, architect.id).model, 'sonnet');
});

test('when the relaunch throws before Terminal is asked (settings file), the session is marked stopped, not left running', async (t) => {
  const { db, launch, developer, deps } = await setup(t);
  deps.writeSettings = () => {
    throw new Error('disk full');
  };
  await assert.rejects(changeSessionModel(launch, { sessionId: developer.id, model: 'opus' }), /could not be relaunched on opus.*disk full.*restart_developer/);
  const row = requireSession(db, developer.id);
  assert.deepEqual([row.state, row.model], ['stopped', 'sonnet']);
});

/** The roster tools with a fake MCP server; `as` switches who is calling. */
function tools(db: ReturnType<typeof tempRoster>, launch: LaunchContext, callerId: number) {
  const ctx: ToolContext = { db, identity: { sessionId: callerId, role: requireSession(db, callerId).role }, pluginRoot: 'I:\\mm', launch };
  const handlers = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as unknown as McpServer;
  registerRosterTools(server, ctx);
  const as = (sessionId: number) => {
    ctx.identity = { sessionId, role: requireSession(db, sessionId).role };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await handlers.get(name)!(args);
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError === true) throw new Error(text);
    return JSON.parse(text);
  };
  return { as, call };
}

test('set_session_model: front desk changes anyone but itself, an architect only its own developers, nobody themselves', async (t) => {
  const { db, desk, launch, architect, developer, runs } = await setup(t);
  const { session: other } = await launchArchitect(launch, { project: 'beta', parentId: desk.id });
  const { session: otherDev } = await launchDeveloper(launch, { architectId: other.id, task: 'beta work', label: 'beta' });
  const { as, call } = tools(db, launch, desk.id);
  const before = runs.length;

  await assert.rejects(call('set_session_model', { session_id: desk.id, model: 'opus' }), /front desk/);
  as(architect.id);
  await assert.rejects(call('set_session_model', { session_id: architect.id, model: 'opus' }), /your own session/);
  await assert.rejects(call('set_session_model', { session_id: other.id, model: 'opus' }), /not yours to change/);
  await assert.rejects(call('set_session_model', { session_id: otherDev.id, model: 'opus' }), /not yours to change/);
  as(developer.id);
  await assert.rejects(call('set_session_model', { session_id: developer.id, model: 'opus' }), /your own session/);
  await assert.rejects(call('set_session_model', { session_id: architect.id, model: 'opus' }), /not yours to change/);
  assert.equal(runs.length, before, 'refusals touch nothing');
  assert.deepEqual(listModelUsage(db), []);

  as(architect.id);
  const stepped = await call('set_session_model', { session_id: developer.id, model: 'opus' });
  assert.deepEqual([stepped.relaunched, stepped.resumed], [true, true]);
  as(desk.id);
  await call('set_session_model', { session_id: other.id, model: 'haiku' });
  const ledger = listModelUsage(db);
  assert.deepEqual(
    ledger.map((r) => [r.session_id, r.from_model, r.to_model, r.reason]),
    [
      [other.id, 'sonnet', 'haiku', 'set_session_model'],
      [developer.id, 'sonnet', 'opus', 'set_session_model'],
    ],
  );
});

test('set_session_model: the front desk steps a developer; asking for the current model changes nothing', async (t) => {
  const { db, desk, launch, developer, runs } = await setup(t);
  const { call } = tools(db, launch, desk.id);
  const before = runs.length;
  const same = await call('set_session_model', { session_id: developer.id, model: 'sonnet' });
  assert.deepEqual([same.relaunched, same.note], [false, 'already on sonnet']);
  assert.equal(runs.length, before, 'the live tab is left alone');
  assert.deepEqual(listModelUsage(db), []);

  const stepped = await call('set_session_model', { session_id: developer.id, model: 'haiku' });
  assert.deepEqual([stepped.relaunched, stepped.resumed], [true, true]);
  assert.equal(requireSession(db, developer.id).model, 'haiku');
  assert.deepEqual(listModelUsage(db).map((r) => [r.session_id, r.from_model, r.to_model]), [[developer.id, 'sonnet', 'haiku']]);
});

test('set_session_model writes no ledger row when the change fails', async (t) => {
  const { db, desk, launch, developer, deps } = await setup(t);
  const { call } = tools(db, launch, desk.id);
  deps.ownsProcess = async () => false;
  await assert.rejects(call('set_session_model', { session_id: developer.id, model: 'opus' }), /model not changed/);
  assert.deepEqual(listModelUsage(db), []);
});

test('set_project_default_model, log_model_use and model_usage', async (t) => {
  const { db, desk, launch, architect, developer } = await setup(t);
  const { as, call } = tools(db, launch, desk.id);

  assert.deepEqual(await call('set_project_default_model', { project: 'alpha', model: 'opus' }), { project: 'alpha', default_model: 'opus' });
  assert.equal(getProjectDefaultModel(db, architect.project_id!), 'opus');
  await call('set_project_default_model', { project: 'alpha', model: null });
  assert.equal(getProjectDefaultModel(db, architect.project_id!), null);
  as(architect.id);
  await assert.rejects(call('set_project_default_model', { project: 'alpha', model: 'opus' }), /Only the front desk/);

  const pulled = await call('log_model_use', { to_model: 'fable', reason: 'auth architecture' });
  assert.ok(pulled.logged > 0);
  as(developer.id);
  await assert.rejects(call('log_model_use', { to_model: 'fable', reason: 'x' }), /Only an architect/);

  as(desk.id);
  const unrelated = registerSession(db, { role: 'architect', projectId: 2, workstreamId: null, name: 'b' });
  await assert.rejects(call('log_model_use', { to_model: 'fable', reason: 'x' }), /Only an architect/);
  as(unrelated.id);
  await call('log_model_use', { to_model: 'fable', reason: 'beta thinking' });
  as(desk.id);
  const all = await call('model_usage');
  assert.deepEqual(all.map((r: { to_model: string; reason: string }) => [r.to_model, r.reason]), [
    ['fable', 'beta thinking'],
    ['fable', 'auth architecture'],
  ]);
  const alpha = await call('model_usage', { project: 'alpha' });
  assert.deepEqual(alpha.map((r: { session_name: string; from_model: string }) => [r.session_name, r.from_model]), [[architect.name, 'sonnet']]);
});

test('only the front desk can hide or show projects and workstreams', async (t) => {
  const { db, desk, launch, architect, developer } = await setup(t);
  const { as, call } = tools(db, launch, developer.id);
  await assert.rejects(call('archive_project', { project: 'beta', archived: true }), /Only the front desk/);
  as(architect.id);
  await assert.rejects(call('archive_workstream', { project: 'beta', workstream: 'main', archived: true }), /Only the front desk/);
  as(desk.id);
  assert.notEqual((await call('archive_project', { project: 'beta', archived: true })).archived_at, null);
  assert.equal((await call('archive_workstream', { project: 'beta', workstream: 'main', archived: false })).archived_at, null);
});
