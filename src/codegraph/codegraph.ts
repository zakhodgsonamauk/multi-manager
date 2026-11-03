import { execFile } from 'node:child_process';
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
