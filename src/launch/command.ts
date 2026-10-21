export interface Command {
  file: string;
  args: string[];
}

export interface SettingsFile {
  path: string;
  content: string;
}

export interface LaunchCommand extends Command {
  settings: SettingsFile;
}

export interface LaunchSpec {
  wtPath: string;
  name: string;
  folder: string;
  role: 'architect' | 'developer';
  skipPermissions: boolean;
  briefingFile: string;
  pluginDir: string;
  settingsPath: string;
  prompt: string;
  sessionId: number;
  parentId: number | null;
  rosterDb: string;
  worktree?: string;
}

export const WT_WINDOW = 'multi-manager';
export const WT_PROFILE = 'Multi-Manager';

function slug(text: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'x' : cleaned;
}

/** mm-<project>-<workstream>[-…]: used for -n, the tab title and the session-file lookup. */
export function sessionName(...parts: string[]): string {
  return ['mm', ...parts.map(slug)].join('-');
}

/** wt.exe treats an unescaped ';' as a sub-command separator. */
export function escapeForWt(arg: string): string {
  return arg.replace(/;/g, '\\;');
}

export function sessionEnv(spec: LaunchSpec): Record<string, string> {
  const env: Record<string, string> = {
    MM_ROLE: spec.role,
    MM_SESSION_ID: String(spec.sessionId),
    MM_ROSTER_DB: spec.rosterDb,
    MM_VOICE: 'off',
  };
  if (spec.parentId !== null) env.MM_PARENT_ID = String(spec.parentId);
  return env;
}

export function buildLaunchCommand(spec: LaunchSpec): LaunchCommand {
  const claude = ['claude', '-n', spec.name];
  if (spec.skipPermissions) claude.push('--dangerously-skip-permissions');
  if (spec.worktree !== undefined) claude.push('--worktree', spec.worktree);
  claude.push(
    '--plugin-dir', spec.pluginDir,
    '--append-system-prompt-file', spec.briefingFile,
    '--settings', spec.settingsPath,
    spec.prompt,
  );
  const args = ['-w', WT_WINDOW, 'new-tab', '--profile', WT_PROFILE, '--title', spec.name, '-d', spec.folder, ...claude];
  return {
    file: spec.wtPath,
    args: args.map(escapeForWt),
    settings: { path: spec.settingsPath, content: `${JSON.stringify({ env: sessionEnv(spec) }, null, 2)}\n` },
  };
}

export function buildStopCommand(pid: number): Command {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid process id ${pid}`);
  return { file: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
}

export function architectPrompt(project: string, workstream: string, goalId?: number): string {
  const start = `You are the Multi-Manager architect for project ${project}, workstream ${workstream}.`;
  if (goalId === undefined) {
    return `${start} No goal yet. Call the roster tool list_items for anything addressed to you, then wait for the front desk.`;
  }
  return `${start} Your goal is roster goal #${goalId}. Call the roster tool get_goal with goal_id ${goalId} and follow your briefing.`;
}

export function developerPrompt(project: string, workstream: string, task: string, sessionId: number): string {
  return `You are a Multi-Manager developer (roster session #${sessionId}) for project ${project}, workstream ${workstream}. Your task: ${task.replace(/;/g, ',')}`;
}
