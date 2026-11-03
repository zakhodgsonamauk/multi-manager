import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { parseProcessList, type ListedProcess } from '../launch/process.ts';
import { launchEnv } from '../launch/runner.ts';

/** The code-review-graph tool connection, exactly as `claude mcp add-json` takes it. */
export const CODE_GRAPH_SERVER_SPEC =
  '{"type":"stdio","command":"code-review-graph","args":["serve"],"env":{"CRG_OPENAI_BASE_URL":"http://127.0.0.1:11434/v1","CRG_OPENAI_API_KEY":"ollama","CRG_OPENAI_MODEL":"qwen3-embedding-ctx2048:4b","CRG_OPENAI_DIMENSION":"512"}}';

export const CODE_GRAPH_SERVER_NAME = 'code-review-graph';

/**
 * The extra tool-connection file a developer's temporary copy is started with (`claude --mcp-config`).
 * Same server as the project folder's, plus CRG_REPO_ROOT so it searches the project folder's index
 * instead of building one for the copy.
 */
export function devMcpConfig(projectFolder: string): string {
  const spec = JSON.parse(CODE_GRAPH_SERVER_SPEC) as { env?: Record<string, string> };
  const server = { ...spec, env: { ...spec.env, CRG_REPO_ROOT: projectFolder } };
  return `${JSON.stringify({ mcpServers: { [CODE_GRAPH_SERVER_NAME]: server } }, null, 2)}
`;
}

/** Every command gets this long before it is given up on. */
export const CODE_GRAPH_TIMEOUT_MS = 60_000;

export interface CodeGraphRunOptions {
  cwd?: string;
  windowsHide: true;
  timeout: number;
  env: NodeJS.ProcessEnv;
  encoding: 'utf8';
}

export interface CodeGraphRunResult {
  /** Exit code 0. */
  ok: boolean;
  /** Exit code; null when the command never ran or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CodeGraphRunner = (file: string, args: string[], options: CodeGraphRunOptions) => Promise<CodeGraphRunResult>;

export interface CodeGraphResult {
  ok: boolean;
  error?: string;
}

/**
 * How every command is started. Never a shell: on Windows a shell strips the quotes out of the JSON argument.
 * The session's Claude Code variables are dropped so they do not leak into the child `claude`.
 */
export function codeGraphSpawnOptions(cwd?: string, env: NodeJS.ProcessEnv = process.env): CodeGraphRunOptions {
  return { ...(cwd === undefined ? {} : { cwd }), windowsHide: true, timeout: CODE_GRAPH_TIMEOUT_MS, env: launchEnv(env), encoding: 'utf8' };
}

/** The real command runner (async, so the roster server is never blocked). */
export const realCodeGraphRunner: CodeGraphRunner = (file, args, options) =>
  new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
      resolve({ ok: error === null, code, stdout, stderr: stderr !== '' ? stderr : (error?.message ?? '') });
    });
  });

export interface CodeGraphProject {
  folder: string;
}

function run(runner: CodeGraphRunner, file: string, args: string[], cwd?: string): Promise<CodeGraphRunResult> {
  return runner(file, args, codeGraphSpawnOptions(cwd));
}

/** What `claude mcp remove code-review-graph -s local` says when there is nothing to remove (exit 1). */
const MCP_ABSENT = /No MCP server named "[^"]*" in local scope/;
/** What `code-review-graph daemon remove <path>` says when the folder is not watched (exit 1). */
const WATCH_ABSENT = /No repository matching '.*' found in config\./;
/** `claude mcp get` prints this when the connection exists in this folder's own (local) scope. */
const MCP_LOCAL = /Scope: Local config/;

const text = (r: CodeGraphRunResult): string => `${r.stdout}\n${r.stderr}`;
const failure = (what: string, r: CodeGraphRunResult): string => `${what} failed: ${(r.stderr || r.stdout).trim() || `exit ${String(r.code)}`}`;
const AGAIN = 'Running the same command again finishes it.';

/** Connects the tool to the project folder (local to that folder) and adds the folder to the watch list. Safe to run twice. */
export async function enableCodeGraph(project: CodeGraphProject, runner: CodeGraphRunner = realCodeGraphRunner): Promise<CodeGraphResult> {
  const installed = await run(runner, 'code-review-graph', ['--version']);
  if (!installed.ok) {
    return { ok: false, error: 'code-review-graph is not installed (`code-review-graph --version` failed), so nothing was changed. Install it first.' };
  }
  // `get` also succeeds for a global connection, so only a local-scope hit lets us skip the add.
  const existing = await run(runner, 'claude', ['mcp', 'get', CODE_GRAPH_SERVER_NAME], project.folder);
  let added = false;
  if (!(existing.ok && MCP_LOCAL.test(text(existing)))) {
    const result = await run(runner, 'claude', ['mcp', 'add-json', CODE_GRAPH_SERVER_NAME, CODE_GRAPH_SERVER_SPEC, '-s', 'local'], project.folder);
    if (!result.ok) return { ok: false, error: `${failure('Adding the tool connection', result)} Nothing was changed.` };
    added = true;
  }
  const watched = await run(runner, 'code-review-graph', ['daemon', 'add', project.folder]);
  if (!watched.ok) {
    const done = added ? 'The tool connection was already added to the project folder, but the folder is not on the watch list. ' : 'The tool connection was already there, but the folder is not on the watch list. ';
    return { ok: false, error: `${failure('Adding the folder to the watch list', watched)} ${done}${AGAIN}` };
  }
  return { ok: true };
}

/** Removes the tool connection and the watch-list entry. "Not found" counts as success. */
export async function disableCodeGraph(project: CodeGraphProject, runner: CodeGraphRunner = realCodeGraphRunner): Promise<CodeGraphResult> {
  const removed = await run(runner, 'claude', ['mcp', 'remove', CODE_GRAPH_SERVER_NAME, '-s', 'local'], project.folder);
  if (!removed.ok && !MCP_ABSENT.test(text(removed))) {
    return { ok: false, error: `${failure('Removing the tool connection', removed)} Nothing was changed.` };
  }
  const unwatched = await run(runner, 'code-review-graph', ['daemon', 'remove', project.folder]);
  if (!unwatched.ok && !WATCH_ABSENT.test(text(unwatched))) {
    return {
      ok: false,
      error: `${failure('Removing the folder from the watch list', unwatched)} The tool connection was already removed from the project folder, but the folder is still on the watch list. ${AGAIN}`,
    };
  }
  return { ok: true };
}

// ---- watcher lifecycle ----------------------------------------------------------------------------------------

/** Everything the watcher code does to the outside world; tests pass fakes. */
export interface WatcherDeps {
  runner: CodeGraphRunner;
  /** Starts a program that never returns (`daemon start`) and does not wait for it. */
  spawnDetached: (file: string, args: string[], options: CodeGraphRunOptions) => void;
  /** Every program whose command line mentions `watch --repo`. */
  listProcesses: () => Promise<ListedProcess[]>;
  /** Closes one program by process id. */
  killPid: (pid: number) => Promise<boolean>;
  log: (line: string) => void;
}

/** What `daemon status` prints while the background watcher program is up. */
const DAEMON_RUNNING = /^Daemon:\s+running/m;

/** A folder watcher: `code-review-graph ... watch --repo <folder>`. The tool-connection programs (`serve`) never match. */
export function isWatcherCommandLine(commandLine: string): boolean {
  return /code-review-graph/i.test(commandLine) && /\bwatch\s+--repo\b/.test(commandLine) && !/\bserve\b/.test(commandLine);
}

/** The folders on the watch list, from `daemon status` (the rows under the "Alias  Path" header). */
export function watchedFolders(status: string): string[] {
  const lines = status.split(/\r?\n/);
  const rule = lines.findIndex((l) => /^\s*-{2,}\s+-{2,}/.test(l));
  if (rule < 0) return [];
  return lines.slice(rule + 1).filter((l) => l.trim() !== '');
}

export const realWatcherDeps: WatcherDeps = {
  runner: realCodeGraphRunner,
  spawnDetached: (file, args, options) => {
    const child = spawn(file, args, { detached: true, windowsHide: true, stdio: 'ignore', env: options.env, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
    child.on('error', () => undefined);
    child.unref();
  },
  listProcesses: async () => {
    const query = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*watch --repo*' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress";
    const result = await realCodeGraphRunner('pwsh', ['-NoProfile', '-NonInteractive', '-Command', query], codeGraphSpawnOptions());
    return result.ok ? parseProcessList(result.stdout) : [];
  },
  // By process id only, and the whole tree (/T) so a watcher's children go with it.
  killPid: async (pid) => (await realCodeGraphRunner('taskkill', ['/PID', String(pid), '/T', '/F'], codeGraphSpawnOptions())).ok,
  log: (line) => {
    console.error(`[code-graph] ${line}`);
  },
};

/** Puts the folder on the watch list and makes sure the background watcher program is running. Never throws. */
export async function ensureWatcher(project: CodeGraphProject, deps: WatcherDeps = realWatcherDeps): Promise<CodeGraphResult> {
  try {
    const added = await run(deps.runner, 'code-review-graph', ['daemon', 'add', project.folder]);
    if (!added.ok) {
      const error = failure('Adding the folder to the watch list', added);
      deps.log(error);
      return { ok: false, error };
    }
    const status = await run(deps.runner, 'code-review-graph', ['daemon', 'status']);
    if (!DAEMON_RUNNING.test(text(status))) {
      // `daemon start` does not return, so it is never waited on.
      deps.spawnDetached('code-review-graph', ['daemon', 'start'], codeGraphSpawnOptions());
    }
    return { ok: true };
  } catch (error) {
    const message = `Starting the folder watcher failed: ${error instanceof Error ? error.message : String(error)}`;
    deps.log(message);
    return { ok: false, error: message };
  }
}

/**
 * Called when an architect or project manager of the project has stopped. While another one is still running
 * nothing changes. Otherwise the folder leaves the watch list; when the list is then empty the background watcher
 * program is stopped and any folder watchers it left behind are closed, each by its own process id. Never throws.
 */
export async function releaseWatcher(project: CodeGraphProject, stillRunning: boolean, deps: WatcherDeps = realWatcherDeps): Promise<CodeGraphResult> {
  if (stillRunning) return { ok: true };
  try {
    const removed = await run(deps.runner, 'code-review-graph', ['daemon', 'remove', project.folder]);
    if (!removed.ok && !WATCH_ABSENT.test(text(removed))) {
      const error = failure('Removing the folder from the watch list', removed);
      deps.log(error);
      return { ok: false, error };
    }
    const status = await run(deps.runner, 'code-review-graph', ['daemon', 'status']);
    if (!status.ok || watchedFolders(text(status)).length > 0) return { ok: true };
    const stopped = await run(deps.runner, 'code-review-graph', ['daemon', 'stop']);
    if (!stopped.ok) deps.log(failure('Stopping the background watcher program', stopped));
    // `daemon stop` ends only the control program on Windows; its folder watchers keep running.
    for (const proc of await deps.listProcesses()) {
      if (!isWatcherCommandLine(proc.commandLine)) continue;
      if (!(await deps.killPid(proc.pid))) deps.log(`Could not close leftover folder watcher ${proc.pid}.`);
    }
    return { ok: true };
  } catch (error) {
    const message = `Stopping the folder watcher failed: ${error instanceof Error ? error.message : String(error)}`;
    deps.log(message);
    return { ok: false, error: message };
  }
}

// ---- stale data -----------------------------------------------------------------------------------------------

export interface GraphFs {
  /** ~/.code-review-graph/registry.json */
  registryPath: string;
  /** Index folders are only ever deleted under this folder. */
  dataRoot: string;
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  rename: (from: string, to: string) => void;
  removeDir: (path: string) => void;
  log: (line: string) => void;
}

export function realGraphFs(env: NodeJS.ProcessEnv = process.env): GraphFs {
  const local = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return {
    registryPath: join(homedir(), '.code-review-graph', 'registry.json'),
    dataRoot: join(local, 'code-review-graph', 'graphs'),
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, content) => {
      writeFileSync(path, content);
    },
    rename: renameSync,
    removeDir: (path) => {
      rmSync(path, { recursive: true, force: true });
    },
    log: (line) => {
      console.error(`[code-graph] ${line}`);
    },
  };
}

/** True if `path` is strictly inside `root`, compared as Windows paths. The root itself does not count. */
export function isInsideRoot(path: string, root: string): boolean {
  const norm = (p: string) => win32.resolve(p).replace(/\\+$/, '').toLowerCase();
  return norm(path).startsWith(`${norm(root)}\\`);
}

interface RegistryRepo {
  path?: unknown;
  data_dir?: unknown;
}

/**
 * Removes registry entries whose project folder is gone (and whose parent folder still exists, so an unmounted drive is not mistaken for deleted projects), and deletes their index folders, but only inside the
 * data root. The registry is rewritten atomically (temp file, then rename). Never throws.
 */
export function pruneStaleGraphData(fs: GraphFs = realGraphFs()): { removed: number } {
  try {
    if (!fs.exists(fs.registryPath)) return { removed: 0 };
    const registry = JSON.parse(fs.readFile(fs.registryPath)) as { repos?: RegistryRepo[] };
    if (!Array.isArray(registry.repos)) return { removed: 0 };
    const kept: RegistryRepo[] = [];
    const stale: RegistryRepo[] = [];
    for (const repo of registry.repos) {
      if (typeof repo.path !== 'string' || repo.path === '' || fs.exists(repo.path)) {
        kept.push(repo);
      } else if (fs.exists(win32.dirname(repo.path))) {
        stale.push(repo);
      } else {
        // The parent is gone too: a drive that is offline or not mounted, not a deleted project.
        fs.log(`Kept ${repo.path}: its folder and the folder around it are both missing (drive offline?).`);
        kept.push(repo);
      }
    }
    if (stale.length === 0) return { removed: 0 };
    const temp = `${fs.registryPath}.tmp`;
    fs.writeFile(temp, `${JSON.stringify({ ...registry, repos: kept }, null, 2)}\n`);
    fs.rename(temp, fs.registryPath);
    for (const repo of stale) {
      if (typeof repo.data_dir !== 'string' || repo.data_dir === '') continue;
      if (!isInsideRoot(repo.data_dir, fs.dataRoot)) {
        fs.log(`Left ${repo.data_dir} alone: it is outside ${fs.dataRoot}.`);
        continue;
      }
      try {
        fs.removeDir(repo.data_dir);
      } catch (error) {
        fs.log(`Could not delete ${repo.data_dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { removed: stale.length };
  } catch (error) {
    fs.log(`Clearing stale code-review-graph data failed: ${error instanceof Error ? error.message : String(error)}`);
    return { removed: 0 };
  }
}
