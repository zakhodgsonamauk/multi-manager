import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { releaseAll } from '../roster/claims.ts';
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
  runningArchitect,
  runningChildren,
  setSessionPid,
  setSessionState,
  setSessionWrapperPid,
  type Session,
} from '../roster/sessions.ts';
import { architectPrompt, buildLaunchCommand, buildStopCommand, developerPrompt, sessionName } from './command.ts';
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
}

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
  const session = registerSession(ctx.db, {
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
  }
  return { session: requireSession(ctx.db, session.id), existing: false, warnings };
}

export async function launchArchitect(
  ctx: LaunchContext,
  input: { project: string; workstream?: string; goalId?: number; parentId: number | null },
): Promise<LaunchResult> {
  const project = requireProject(ctx.db, input.project);
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
    prompt: () => architectPrompt(project.name, workstream.name, input.goalId),
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
  const workstream = requireWorkstreamById(ctx.db, architect.workstream_id);
  const name = sessionName(project.name, workstream.name, 'dev', input.label);
  return launchTab(ctx, {
    role: 'developer',
    project,
    workstream,
    name,
    parentId: architect.id,
    prompt: (sessionId) => developerPrompt(project.name, workstream.name, input.task, sessionId),
    worktree: name,
  });
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
