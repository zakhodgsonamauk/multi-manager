import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { releaseAll } from '../roster/claims.ts';
import { assertNotPaused } from '../roster/pause.ts';
import { getSessionTask, saveSessionTask } from '../roster/session-tasks.ts';
import { isWorkModel, resolveLaunchModel } from '../roster/models.ts';
import { resolveDbPath, type Env } from '../roster/db.ts';
import { requireGoal, updateGoal } from '../roster/goals.ts';
import {
  DEFAULT_PERMISSION_MODE,
  getProjectDefaultModel,
  requireProject,
  requireProjectById,
  requireWorkstream,
  requireWorkstreamById,
  type Project,
  type Workstream,
} from '../roster/projects.ts';
import {
  registerSession,
  requireSession,
  reviveSession,
  runningArchitect,
  runningChildren,
  setClaudeSessionId,
  setSessionModel,
  setSessionPid,
  setSessionScores,
  setSessionState,
  setSessionWrapperPid,
  type Session,
} from '../roster/sessions.ts';
import {
  architectPrompt,
  buildLaunchCommand,
  buildStopCommand,
  developerPrompt,
  modelChangePrompt,
  restartPrompt,
  sessionName,
} from './command.ts';
import type { LaunchDeps } from './runner.ts';
import { sessionFiles, sessionStateDir, wrapperMarker, type SessionFiles } from './wrapper.ts';

export interface LaunchContext {
  db: DatabaseSync;
  deps: LaunchDeps;
  pluginRoot: string;
  env: Env;
}

export interface LaunchResult {
  session: Session;
  existing: boolean;
  warnings: string[];
}

export interface StopResult {
  session: Session;
  killed: boolean;
  warnings: string[];
}

interface TabSpec {
  role: 'architect' | 'developer';
  project: Project;
  workstream: Workstream;
  name: string;
  parentId: number | null;
  prompt: (sessionId: number) => string;
  worktree?: string;
  /** Relaunch under this existing roster row instead of registering a new one. */
  reuse?: Session;
  /** Continue this Claude Code conversation (`claude --resume`). */
  resumeId?: string;
  /** The model the tab runs on; recorded on the session row once it is launched. */
  model: string;
}

export interface RestartResult extends LaunchResult {
  /** True if the earlier conversation was resumed; false if it could not be and a fresh one was started. */
  resumed: boolean;
}

/** Claude Code conversation ids are UUIDs; anything else is not passed to --resume. */
const CONVERSATION_ID = /^[A-Za-z0-9_-]+$/;

export function wtPath(env: Env): string {
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe') : 'wt.exe';
}

export function permissionWarning(project: Project): string | null {
  if (project.permission_mode === DEFAULT_PERMISSION_MODE) return null;
  return (
    `Project ${project.name} uses permission mode "${project.permission_mode}" instead of ${DEFAULT_PERMISSION_MODE}. ` +
    'Claude Code holds cross-session messages between sessions in different permission modes, ' +
    'so messages to and from its sessions will be held for your approval.'
  );
}

/** The model a new tab runs on: an explicit model, else the task scores (developers), else the project default, else sonnet. */
function modelFor(
  ctx: LaunchContext,
  role: 'architect' | 'developer',
  projectId: number,
  input: { model?: string | null; complexity?: number | null; clarity?: number | null },
): string {
  return resolveLaunchModel({
    role,
    modelOverride: input.model ?? null,
    complexity: input.complexity ?? null,
    clarity: input.clarity ?? null,
    projectDefaultModel: getProjectDefaultModel(ctx.db, projectId),
  });
}

async function launchTab(ctx: LaunchContext, tab: TabSpec): Promise<LaunchResult> {
  const warnings: string[] = [];
  const warning = permissionWarning(tab.project);
  if (warning !== null) warnings.push(warning);
  ctx.deps.ensureTerminalProfile();
  const session =
    tab.reuse !== undefined
      ? reviveSession(ctx.db, tab.reuse.id)
      : registerSession(ctx.db, {
          role: tab.role,
          parentId: tab.parentId,
          projectId: tab.project.id,
          workstreamId: tab.workstream.id,
          name: tab.name,
          folder: tab.project.folder,
        });
  const rosterDb = resolveDbPath(ctx.env);
  const files = sessionFiles(sessionStateDir(rosterDb), session.id);
  ctx.deps.removeFiles([files.wrapperPid, files.exit]);
  const command = buildLaunchCommand({
    wtPath: wtPath(ctx.env),
    name: tab.name,
    folder: tab.project.folder,
    role: tab.role,
    skipPermissions: warning === null,
    briefingFile: join(ctx.pluginRoot, 'briefings', `${tab.role}.md`),
    pluginDir: ctx.pluginRoot,
    settingsPath: files.settings,
    prompt: tab.prompt(session.id),
    sessionId: session.id,
    parentId: tab.parentId,
    rosterDb,
    worktree: tab.worktree,
    resumeId: tab.resumeId,
    model: tab.model,
  });
  ctx.deps.writeSettings(command.settings);
  const since = Date.now() - 1000;
  const result = await ctx.deps.run(command);
  if (result.code !== 0) {
    setSessionState(ctx.db, session.id, 'stopped');
    throw new Error(`Windows Terminal launch failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
  // Recorded only once the tab is open, so a failed launch leaves the session's model as it was.
  setSessionModel(ctx.db, session.id, tab.model);
  // The wrapper writes its pid before it starts claude, so wait for it first.
  const wrapperPid = await ctx.deps.waitForWrapperPid(files.wrapperPid);
  if (wrapperPid === null) {
    warnings.push(`${tab.name}'s wrapper did not report its process id yet. Stopping it will read ${files.wrapperPid} again.`);
  } else {
    setSessionWrapperPid(ctx.db, session.id, wrapperPid);
  }
  const pid = await ctx.deps.waitForPid(tab.name, since);
  if (pid === null) {
    warnings.push(`${tab.name} was launched but its process id was not found yet. Stopping it will look the id up again by name.`);
  } else {
    setSessionPid(ctx.db, session.id, pid);
    // Remember the conversation so a crash or reboot can resume it; the monitor fills it in if it is not written yet.
    const conversation = ctx.deps.readClaudeSessionId?.(pid) ?? null;
    if (conversation !== null) setClaudeSessionId(ctx.db, session.id, conversation);
  }
  return { session: requireSession(ctx.db, session.id), existing: false, warnings };
}

export async function launchArchitect(
  ctx: LaunchContext,
  input: { project: string; workstream?: string; goalId?: number; parentId: number | null; extraPrompt?: string; model?: string },
): Promise<LaunchResult> {
  const project = requireProject(ctx.db, input.project);
  assertNotPaused(ctx.db, project.id);
  const workstream = requireWorkstream(ctx.db, project.id, input.workstream ?? 'main');
  const existing = runningArchitect(ctx.db, workstream.id);
  if (existing !== undefined) return { session: existing, existing: true, warnings: [] };
  if (input.goalId !== undefined && requireGoal(ctx.db, input.goalId).workstream_id !== workstream.id) {
    throw new Error(`Goal #${input.goalId} does not belong to ${project.name}/${workstream.name}`);
  }
  const result = await launchTab(ctx, {
    role: 'architect',
    project,
    workstream,
    name: sessionName(project.name, workstream.name),
    parentId: input.parentId,
    model: modelFor(ctx, 'architect', project.id, { model: input.model }),
    prompt: () => [architectPrompt(project.name, workstream.name, input.goalId), input.extraPrompt].filter(Boolean).join(' '),
  });
  if (input.goalId !== undefined) updateGoal(ctx.db, input.goalId, { state: 'planning' });
  return result;
}

export async function launchDeveloper(
  ctx: LaunchContext,
  input: { architectId: number; task: string; label: string; complexity?: number; clarity?: number; model?: string },
): Promise<LaunchResult> {
  const architect = requireSession(ctx.db, input.architectId);
  if (architect.role !== 'architect' || architect.project_id === null || architect.workstream_id === null) {
    throw new Error('Only an architect with a project workstream can launch developer sessions');
  }
  const project = requireProjectById(ctx.db, architect.project_id);
  assertNotPaused(ctx.db, project.id);
  const workstream = requireWorkstreamById(ctx.db, architect.workstream_id);
  const name = sessionName(project.name, workstream.name, 'dev', input.label);
  const result = await launchTab(ctx, {
    role: 'developer',
    project,
    workstream,
    name,
    parentId: architect.id,
    model: modelFor(ctx, 'developer', project.id, input),
    prompt: (sessionId) => developerPrompt(project.name, workstream.name, input.task, sessionId),
    worktree: name,
  });
  saveSessionTask(ctx.db, result.session.id, input.label, input.task);
  if (input.complexity !== undefined || input.clarity !== undefined) {
    setSessionScores(ctx.db, result.session.id, input.complexity ?? null, input.clarity ?? null);
  }
  return { ...result, session: requireSession(ctx.db, result.session.id) };
}

/**
 * Picks what to kill, never anything that is not provably ours: first the wrapper (a live pwsh.exe whose
 * script carries this session's marker; killing it closes the kill-on-close Job, so the whole session
 * goes), else the claude.exe whose session file names this session (sessions launched before the wrapper) and,
 * when looked up by name, runs inside its folder (another cluster can have a tab of the same name).
 */
async function killTarget(ctx: LaunchContext, session: Session, files: SessionFiles, warnings: string[]): Promise<number | null> {
  const label = session.name ?? `session #${session.id}`;
  const wrapperPid = session.wrapper_pid ?? ctx.deps.readWrapperPid(files.wrapperPid);
  if (wrapperPid !== null) {
    if (await ctx.deps.ownsWrapper(wrapperPid, wrapperMarker(session.id, resolveDbPath(ctx.env)))) return wrapperPid;
    warnings.push(`Process ${wrapperPid} is not ${label}'s wrapper any more.`);
  }
  const pid = session.pid ?? (session.name === null ? null : await ctx.deps.findPid(session.name, session.folder ?? undefined));
  if (pid === null) {
    warnings.push(`No live process id is known for ${label}. It was marked stopped without killing anything.`);
    return null;
  }
  if (session.name === null || !(await ctx.deps.ownsProcess(pid, session.name))) {
    warnings.push(`Process ${pid} is not ${label}'s claude.exe any more, so nothing was killed.`);
    return null;
  }
  return pid;
}

/** Stops running children first, kills this session's process tree if (and only if) it is ours, then removes its state files. */
export async function stopSession(ctx: LaunchContext, sessionId: number): Promise<StopResult> {
  const session = requireSession(ctx.db, sessionId);
  if (session.role === 'front-desk') throw new Error('Multi-Manager does not stop the front desk');
  const warnings: string[] = [];
  for (const child of runningChildren(ctx.db, session.id)) {
    warnings.push(...(await stopSession(ctx, child.id)).warnings);
  }
  const files = sessionFiles(sessionStateDir(resolveDbPath(ctx.env)), session.id);
  let killed = false;
  const target = await killTarget(ctx, session, files, warnings);
  if (target !== null) {
    const result = await ctx.deps.run(buildStopCommand(target));
    killed = result.code === 0;
    if (!killed) warnings.push(`taskkill exited with ${result.code}: ${result.stderr || result.stdout}`);
  }
  ctx.deps.removeFiles([files.settings, files.wrapperPid, files.exit]);
  setSessionState(ctx.db, session.id, 'stopped');
  releaseAll(ctx.db, session.id);
  return { session: requireSession(ctx.db, session.id), killed, warnings };
}

export async function stopArchitect(ctx: LaunchContext, input: { project: string; workstream?: string }): Promise<StopResult> {
  const project = requireProject(ctx.db, input.project);
  const workstream = requireWorkstream(ctx.db, project.id, input.workstream ?? 'main');
  const architect = runningArchitect(ctx.db, workstream.id);
  if (architect === undefined) throw new Error(`No running architect for ${project.name}/${workstream.name}`);
  return stopSession(ctx, architect.id);
}

/**
 * Brings a dead (or hung) architect back under the same roster id, so its developers, items and goals stay
 * attached. Kills only its own leftovers (never its developers), then relaunches with `claude --resume` on its
 * saved conversation, or a fresh conversation that is told the earlier one could not be restored.
 * Never called automatically: the front desk offers it and the user says yes.
 */
export async function restartArchitect(ctx: LaunchContext, input: { sessionId: number; reason: string }): Promise<RestartResult> {
  const old = requireSession(ctx.db, input.sessionId);
  if (old.role !== 'architect' || old.project_id === null || old.workstream_id === null) {
    throw new Error(`Session #${old.id} is not an architect with a project workstream`);
  }
  const project = requireProjectById(ctx.db, old.project_id);
  assertNotPaused(ctx.db, project.id);
  const workstream = requireWorkstreamById(ctx.db, old.workstream_id);
  const other = runningArchitect(ctx.db, workstream.id);
  if (other !== undefined && other.id !== old.id) {
    throw new Error(`Architect #${other.id} (${other.name ?? 'unnamed'}) is already running for ${project.name}/${workstream.name}. Talk to it, or stop it first.`);
  }
  const warnings: string[] = [];
  // Leftovers: kill only a wrapper or claude.exe that is provably this session's. Most often there is none,
  // so "nothing to kill" is not worth a warning here.
  const closed = await killOwnProcess(ctx, old, []);
  if (closed !== null) {
    warnings.push(closed.code === 0 ? `Closed ${old.name ?? `session #${old.id}`}'s leftover process ${closed.target}.` : `taskkill of leftover ${closed.target} exited with ${closed.code}.`);
  }
  markClosed(ctx, old);
  releaseAll(ctx.db, old.id);
  const id = old.claude_session_id;
  const resumed = id !== null && CONVERSATION_ID.test(id) && (ctx.deps.conversationExists?.(id) ?? true);
  if (!resumed) {
    setClaudeSessionId(ctx.db, old.id, null);
    warnings.push(
      id === null
        ? 'No saved conversation id for this architect, so it starts a fresh conversation and re-reads its progress log.'
        : `Conversation ${id} could not be found, so it starts a fresh conversation and re-reads its progress log.`,
    );
  }
  const result = await launchTab(ctx, {
    role: 'architect',
    project,
    workstream,
    name: old.name ?? sessionName(project.name, workstream.name),
    parentId: old.parent_id,
    // Keep the model it ran on; a session from before models were recorded gets the project default.
    model: modelFor(ctx, 'architect', project.id, { model: old.model }),
    prompt: () => restartPrompt(project.name, workstream.name, input.reason, resumed),
    reuse: old,
    resumeId: resumed ? (id ?? undefined) : undefined,
  });
  return { ...result, warnings: [...warnings, ...result.warnings], resumed };
}

/** Kills this session's own process tree, never anything not provably its own. Null if there was nothing to kill (see warnings). */
async function killOwnProcess(ctx: LaunchContext, session: Session, warnings: string[]): Promise<{ target: number; code: number } | null> {
  const files = sessionFiles(sessionStateDir(resolveDbPath(ctx.env)), session.id);
  const target = await killTarget(ctx, session, files, warnings);
  if (target === null) return null;
  return { target, code: (await ctx.deps.run(buildStopCommand(target))).code };
}

/**
 * The conversation id of a session's live claude.exe (found by name if its pid was never recorded), saved on its
 * row, or null. Only a process whose session file names this session, with its cwd inside the session's folder,
 * counts: another cluster can have a tab of the same name.
 */
async function readLiveConversation(ctx: LaunchContext, session: Session, name: string): Promise<string | null> {
  if (ctx.deps.readClaudeSessionId === undefined) return null;
  const pid = session.pid ?? (session.folder === null ? null : await ctx.deps.findPid(name, session.folder));
  if (pid === null || !(await ctx.deps.ownsProcess(pid, name))) return null;
  const id = ctx.deps.readClaudeSessionId(pid);
  if (id !== null) setClaudeSessionId(ctx.db, session.id, id);
  return id;
}

/** Removes a closed session's state files and marks it stopped. */
function markClosed(ctx: LaunchContext, session: Session): void {
  const files = sessionFiles(sessionStateDir(resolveDbPath(ctx.env)), session.id);
  ctx.deps.removeFiles([files.settings, files.wrapperPid, files.exit]);
  setSessionState(ctx.db, session.id, 'stopped');
}

export interface ChangeModelResult {
  session: Session;
  /** True if a running tab was closed and relaunched on the new model; false if the model was only recorded. */
  relaunched: boolean;
  /** True if the relaunch continued the earlier conversation. */
  resumed: boolean;
  warnings: string[];
}

/**
 * Steps an architect or developer up or down to a new model. A running tab is closed and relaunched under the
 * same roster id on the new model, continuing its conversation (`--resume`); if that cannot be restored it starts
 * fresh with its role (and a developer's original task). It keeps its claims and its children keep running.
 * If its process cannot be provably closed, nothing is relaunched and the model is not changed (two tabs on one
 * conversation would be worse). If the relaunch fails after the close, the tab is down: the model stays as it was,
 * its claims are released and the error names the restart tool.
 * A stopped session just records the model for its next launch. The caller writes the model ledger.
 */
export async function changeSessionModel(ctx: LaunchContext, input: { sessionId: number; model: string }): Promise<ChangeModelResult> {
  const old = requireSession(ctx.db, input.sessionId);
  if (old.role === 'front-desk') throw new Error("Multi-Manager does not change the front desk's model");
  if (!isWorkModel(input.model)) throw new Error(`Unknown work model "${input.model}": use haiku, sonnet or opus`);
  if (old.project_id === null || old.workstream_id === null) throw new Error(`Session #${old.id} has no project workstream to relaunch`);
  if (old.state !== 'running') {
    setSessionModel(ctx.db, old.id, input.model);
    return { session: requireSession(ctx.db, old.id), relaunched: false, resumed: false, warnings: [] };
  }
  const project = requireProjectById(ctx.db, old.project_id);
  assertNotPaused(ctx.db, project.id);
  const workstream = requireWorkstreamById(ctx.db, old.workstream_id);
  const role = old.role;
  // A developer's name is its worktree, so it cannot be guessed.
  if (role === 'developer' && old.name === null) throw new Error(`Developer #${old.id} has no name, so its worktree is unknown`);
  const name = old.name ?? sessionName(project.name, workstream.name);
  // Read before the close: a launch that gave up waiting for the process recorded no conversation id.
  const id = old.claude_session_id ?? (await readLiveConversation(ctx, old, name));
  const why: string[] = [];
  const closed = await killOwnProcess(ctx, old, why);
  if (closed !== null && closed.code !== 0) why.push(`taskkill of process ${closed.target} exited with ${closed.code}.`);
  if (closed === null || closed.code !== 0) {
    const stop = role === 'architect' ? 'stop_architect' : 'stop_developer';
    throw new Error(
      `Multi-Manager could not close ${name}'s tab, model not changed. ${why.join(' ')} ` +
        `If its tab is already gone, stop it (${stop}) and change the model again: a stopped session just records it.`,
    );
  }
  markClosed(ctx, old);
  const warnings: string[] = [];
  const resumed = id !== null && CONVERSATION_ID.test(id) && (ctx.deps.conversationExists?.(id) ?? true);
  const change = modelChangePrompt(role, input.model, resumed);
  let prompt = change;
  if (!resumed) {
    setClaudeSessionId(ctx.db, old.id, null);
    warnings.push(
      id === null
        ? `No saved conversation id for ${name}, so it starts a fresh conversation.`
        : `Conversation ${id} could not be found, so ${name} starts a fresh conversation.`,
    );
    if (role === 'architect') {
      prompt = `You are the Multi-Manager architect for project ${project.name}, workstream ${workstream.name}. ${change}`;
    } else {
      const task = getSessionTask(ctx.db, old.id);
      if (task === undefined) warnings.push(`No stored task for ${name}, so it is relaunched without its task: tell it again.`);
      prompt = task === undefined ? change : `${developerPrompt(project.name, workstream.name, task.task, old.id)} ${change}`;
    }
  }
  let result: LaunchResult;
  try {
    result = await launchTab(ctx, {
      role,
      project,
      workstream,
      name,
      parentId: old.parent_id,
      model: input.model,
      prompt: () => prompt,
      worktree: role === 'developer' ? name : undefined,
      reuse: old,
      resumeId: resumed ? (id ?? undefined) : undefined,
    });
  } catch (error) {
    // The tab is down and nobody works on its files now. launchTab marks it stopped when Terminal refuses the tab,
    // but not when it throws earlier (settings file, terminal profile), so say so here too.
    setSessionState(ctx.db, old.id, 'stopped');
    releaseAll(ctx.db, old.id);
    const restart = role === 'architect' ? 'restart_architect (front desk)' : 'restart_developer (its architect)';
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}'s tab was closed but could not be relaunched on ${input.model}: ${reason}. It is down and still on ${old.model ?? 'no recorded model'}: bring it back with ${restart}.`, { cause: error });
  }
  return { session: result.session, relaunched: true, resumed, warnings: [...warnings, ...result.warnings] };
}
