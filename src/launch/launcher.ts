import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { releaseAll } from '../roster/claims.ts';
import { assertNotPaused } from '../roster/pause.ts';
import { saveSessionTask } from '../roster/session-tasks.ts';
import { resolveDbPath, type Env } from '../roster/db.ts';
import { requireGoal, updateGoal } from '../roster/goals.ts';
import {
  DEFAULT_PERMISSION_MODE,
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
  setSessionPid,
  setSessionState,
  setSessionWrapperPid,
  type Session,
} from '../roster/sessions.ts';
import { architectPrompt, buildLaunchCommand, buildStopCommand, developerPrompt, restartPrompt, sessionName } from './command.ts';
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
  });
  ctx.deps.writeSettings(command.settings);
  const since = Date.now() - 1000;
  const result = await ctx.deps.run(command);
  if (result.code !== 0) {
    setSessionState(ctx.db, session.id, 'stopped');
    throw new Error(`Windows Terminal launch failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
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
  input: { project: string; workstream?: string; goalId?: number; parentId: number | null; extraPrompt?: string },
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
    prompt: () => [architectPrompt(project.name, workstream.name, input.goalId), input.extraPrompt].filter(Boolean).join(' '),
  });
  if (input.goalId !== undefined) updateGoal(ctx.db, input.goalId, { state: 'planning' });
  return result;
}

export async function launchDeveloper(
  ctx: LaunchContext,
  input: { architectId: number; task: string; label: string },
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
    prompt: (sessionId) => developerPrompt(project.name, workstream.name, input.task, sessionId),
    worktree: name,
  });
  saveSessionTask(ctx.db, result.session.id, input.label, input.task);
  return result;
}

/**
 * Picks what to kill, never anything that is not provably ours: first the wrapper (a live pwsh.exe whose
 * script carries this session's marker; killing it closes the kill-on-close Job, so the whole session
 * goes), else the claude.exe whose session file names this session (sessions launched before the wrapper).
 */
async function killTarget(ctx: LaunchContext, session: Session, files: SessionFiles, warnings: string[]): Promise<number | null> {
  const label = session.name ?? `session #${session.id}`;
  const wrapperPid = session.wrapper_pid ?? ctx.deps.readWrapperPid(files.wrapperPid);
  if (wrapperPid !== null) {
    if (await ctx.deps.ownsWrapper(wrapperPid, wrapperMarker(session.id, resolveDbPath(ctx.env)))) return wrapperPid;
    warnings.push(`Process ${wrapperPid} is not ${label}'s wrapper any more.`);
  }
  const pid = session.pid ?? (session.name === null ? null : await ctx.deps.findPid(session.name));
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
  const files = sessionFiles(sessionStateDir(resolveDbPath(ctx.env)), old.id);
  // Leftovers: kill only a wrapper or claude.exe that is provably this session's. Most often there is none.
  const target = await killTarget(ctx, old, files, []);
  if (target !== null) {
    const result = await ctx.deps.run(buildStopCommand(target));
    warnings.push(result.code === 0 ? `Closed ${old.name ?? `session #${old.id}`}'s leftover process ${target}.` : `taskkill of leftover ${target} exited with ${result.code}.`);
  }
  ctx.deps.removeFiles([files.settings, files.wrapperPid, files.exit]);
  setSessionState(ctx.db, old.id, 'stopped');
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
    prompt: () => restartPrompt(project.name, workstream.name, input.reason, resumed),
    reuse: old,
    resumeId: resumed ? (id ?? undefined) : undefined,
  });
  return { ...result, warnings: [...warnings, ...result.warnings], resumed };
}
