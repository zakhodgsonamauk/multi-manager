import { buildWrapperScript, encodeCommand, PWSH_ARGS, sessionStateDir } from './wrapper.ts';

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
  /** The extra tool-connection file to write before the tab opens; only when the spec carries one. */
  mcpConfig?: SettingsFile;
}

export interface LaunchSpec {
  wtPath: string;
  name: string;
  /** Where the tab opens: the project folder, or a developer's own copy under it. */
  folder: string;
  role: 'architect' | 'project-manager' | 'developer';
  skipPermissions: boolean;
  briefingFile: string;
  pluginDir: string;
  settingsPath: string;
  /** A tool-connection file passed as `--mcp-config` (never `--strict-mcp-config`, which would drop the plugin's own roster tool). */
  mcpConfigPath?: string;
  /** What `buildLaunchCommand` hands back to write at `mcpConfigPath`. */
  mcpConfigContent?: string;
  prompt: string;
  sessionId: number;
  parentId: number | null;
  rosterDb: string;
  /** Optional Job process cap for the session's whole tree; unset means no cap. */
  maxProcesses?: number;
  /** Claude Code conversation id to continue (`claude --resume <id>`); unset starts a fresh conversation. */
  resumeId?: string;
  /** The model the tab runs on (`claude --model <model>`); unset omits the flag. */
  model?: string;
  /**
   * Plugin keys (`name@marketplace`) to switch off for this tab only. When set, the session settings also
   * switch off the claude.ai connectors. Unset (the front desk) leaves both alone.
   */
  disabledPlugins?: string[];
}

/** Plugins a manager tab keeps on: Multi-Manager itself, the Chrome tools, second-opinion, code-review-graph. */
export const KEEP_PLUGINS = [
  'multi-manager', 'claude-in-chrome', 'second-opinion', 'code-review-graph',
  // Hook plugins the user relies on (spoken notifications, sounds, reply rewriting), not skill bulk.
  'session-voice', 'cc-sounds', 'claudish-to-english',
];

/** The plugin keys to switch off: every installed one whose name (before the @) is not on the keep-list. */
export function pluginsToDisable(installedKeys: string[], keep: string[] = KEEP_PLUGINS): string[] {
  return installedKeys.filter((key) => !keep.includes(key.split('@')[0] ?? key));
}

export function settingsContent(spec: LaunchSpec): string {
  const settings: Record<string, unknown> = { env: sessionEnv(spec) };
  if (spec.disabledPlugins !== undefined) {
    settings.enabledPlugins = Object.fromEntries(spec.disabledPlugins.map((key) => [key, false]));
    settings.disableClaudeAiConnectors = true;
  }
  return `${JSON.stringify(settings, null, 2)}
`;
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

/** Above the default 200000-token refresh limit, so the roster's fresh restart normally acts first. */
export const MANAGER_COMPACT_WINDOW_TOKENS = 400_000;

export function sessionEnv(spec: LaunchSpec): Record<string, string> {
  const env: Record<string, string> = {
    MM_ROLE: spec.role,
    MM_SESSION_ID: String(spec.sessionId),
    MM_ROSTER_DB: spec.rosterDb,
    MM_VOICE: 'off',
  };
  if (spec.parentId !== null) env.MM_PARENT_ID = String(spec.parentId);
  if (spec.role === 'architect' || spec.role === 'project-manager') {
    // Safety net behind the roster's own fresh restart: Claude Code summarises the conversation on its own once it nears this size.
    // Checked in a real launch: a low value made it summarise (a compact_boundary event).
    env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(MANAGER_COMPACT_WINDOW_TOKENS);
  }
  if (spec.role === 'developer') {
    // A developer's copy sits deep under .claude/worktrees, where long file names pass Windows' 260-character
    // limit: every git it runs gets core.longpaths=true (as if passed with -c), without touching any git config file.
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'core.longpaths';
    env.GIT_CONFIG_VALUE_0 = 'true';
  }
  return env;
}

/** The arguments after `claude` that the wrapper runs. */
export function claudeArgs(spec: LaunchSpec): string[] {
  const args = spec.resumeId === undefined ? [] : ['--resume', spec.resumeId];
  args.push('-n', spec.name);
  if (spec.model !== undefined) args.push('--model', spec.model);
  if (spec.skipPermissions) args.push('--dangerously-skip-permissions');
  // --mcp-config takes several values, so it must never sit right before the prompt: another option always follows it.
  if (spec.mcpConfigPath !== undefined) args.push('--mcp-config', spec.mcpConfigPath);
  args.push(
    '--plugin-dir', spec.pluginDir,
    '--append-system-prompt-file', spec.briefingFile,
    '--settings', spec.settingsPath,
    spec.prompt,
  );
  return args;
}

/**
 * wt.exe opens a tab running pwsh with the wrapper script (wrapper.ts) as -EncodedCommand: paths with
 * spaces and parentheses do not survive Terminal re-hosting otherwise, and base64 never holds wt's ';'.
 */
export function buildLaunchCommand(spec: LaunchSpec): LaunchCommand {
  const script = buildWrapperScript({
    sessionId: spec.sessionId,
    rosterDb: spec.rosterDb,
    stateDir: sessionStateDir(spec.rosterDb),
    folder: spec.folder,
    claudeArgs: claudeArgs(spec),
    maxProcesses: spec.maxProcesses,
  });
  const tab = ['-w', WT_WINDOW, 'new-tab', '--profile', WT_PROFILE, '--title', spec.name, '-d', spec.folder].map(escapeForWt);
  return {
    file: spec.wtPath,
    args: [...tab, 'pwsh', ...PWSH_ARGS, encodeCommand(script)],
    settings: { path: spec.settingsPath, content: settingsContent(spec) },
    ...(spec.mcpConfigPath !== undefined && spec.mcpConfigContent !== undefined
      ? { mcpConfig: { path: spec.mcpConfigPath, content: spec.mcpConfigContent } }
      : {}),
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

/** What a new project manager is told. It lives on the project's pm workstream. */
export function projectManagerPrompt(project: string, goalId?: number): string {
  const start = `You are the Multi-Manager project manager for project ${project}.`;
  if (goalId === undefined) {
    return `${start} No goal yet. Call the roster tool list_items for anything addressed to you, then wait for the front desk.`;
  }
  return `${start} Your goal is roster goal #${goalId}. Call the roster tool get_goal with goal_id ${goalId} and follow your briefing.`;
}

/**
 * Reasons that make restartPrompt start the session fresh from its written notes instead of asking it to wait.
 * They travel in the reason text because restartArchitect passes only that (launcher.ts is not changed for this).
 */
export const FRESH_AFTER_REFRESH = 'its conversation grew large, so it was refreshed on purpose';
export const FRESH_AFTER_IDLE_STOP = 'it was stopped while idle to save usage, and an item is now waiting for it';

/** The start prompt of a deliberate fresh start: resume from the written notes, never redo finished work, do not wait for a go. */
export function freshStartPrompt(project: string, workstream: string, reason: string, role: 'architect' | 'project-manager'): string {
  const who = role === 'project-manager' ? `project manager for project ${project}` : `architect for project ${project}, workstream ${workstream}`;
  return [
    `You are the Multi-Manager ${who}.`,
    `You were started with a fresh conversation because ${reason}. You remember nothing of earlier work, but your notes are complete.`,
    'Resume from your own notes: read status.md and progress.md (the project notes named in your briefing) and do not redo anything they record as done.',
    role === 'project-manager' ? 'Then check_in, list_items, team_health and list_sessions.' : 'Then check_in, list_items, and get_goal for your goal.',
    'Re-arm your timer if progress.md shows it has expired, carry on from where the notes stop, and answer any item addressed to you. Your developers kept running; do not relaunch them.',
  ].join(' ');
}

/** What a restarted architect or project manager is told: catch up, report, and wait for the user's go. */
export function restartPrompt(
  project: string,
  workstream: string,
  reason: string,
  restored: boolean,
  role: 'architect' | 'project-manager' = 'architect',
): string {
  if (reason === FRESH_AFTER_REFRESH || reason === FRESH_AFTER_IDLE_STOP) return freshStartPrompt(project, workstream, reason, role);
  const who = role === 'project-manager' ? `project manager for project ${project}` : `architect for project ${project}, workstream ${workstream}`;
  const why = reason.replace(/[;\r\n]+/g, ', ').trim() || 'an unexpected stop';
  const parts = [
    ...(restored ? [] : [`You are the Multi-Manager ${who}.`]),
    `You were restarted after ${why}.`,
    ...(restored ? [] : ['Your earlier conversation could not be restored.']),
    "Re-read your progress log, check_in, list_items, then summarise status to the front desk and WAIT for the user's go before starting new work.",
    role === 'project-manager' ? 'Do not relaunch architects until then.' : 'Do not relaunch developers until then.',
  ];
  return parts.join(' ');
}

/**
 * What a relaunched session is told when its model changed. A developer carries on with its task (it was
 * stepped mid-task, so waiting would stall it); an architect waits for the user's go, like after a restart.
 */
export function modelChangePrompt(role: 'architect' | 'project-manager' | 'developer', model: string, restored: boolean): string {
  const start = `Your model was changed to ${model}. You were relaunched on it.`;
  if (role === 'developer') {
    const state = restored
      ? 'Your earlier conversation was preserved.'
      : 'Your earlier conversation could not be restored, so this is a fresh one: check your branch and worktree for earlier work first.';
    return `${start} ${state} check_in and continue your task where you stopped.`;
  }
  const state = restored
    ? 'Your earlier conversation was preserved.'
    : 'Your earlier conversation could not be restored, so this is a fresh one: re-read your state files and progress log.';
  return `${start} ${state} Re-read your state, check_in, and continue where you stopped. WAIT for the user's go before starting new work or relaunching developers.`;
}

export function developerPrompt(project: string, workstream: string, task: string, sessionId: number): string {
  return `You are a Multi-Manager developer (roster session #${sessionId}) for project ${project}, workstream ${workstream}. Your task: ${task.replace(/;/g, ',')}`;
}
