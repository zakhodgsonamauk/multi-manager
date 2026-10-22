import type { SpawnOptions } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { escapeForWt } from './command.ts';
import { encodeCommand, PWSH_ARGS, psQuote } from './wrapper.ts';

/**
 * The per-cluster roster DB: <folder>/.multi-manager/roster.db.
 * The front desk tab sets MM_ROSTER_DB to this path; every session it launches inherits it.
 */
export function clusterDbPath(folder: string): string {
  return join(folder, '.multi-manager', 'roster.db');
}

/**
 * Creates <folder>/.multi-manager with a .gitignore of `*`, so a cluster folder that is a git repo does not
 * show the roster as untracked. Never touches the folder's own .gitignore, nor an existing one in here.
 */
export function ensureClusterDir(folder: string): void {
  const dir = join(folder, '.multi-manager');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

/** Variables a session started from inside another Claude Code session inherits; with them it never registers for messaging. */
export const INHERITED_CLAUDE_VARS = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
] as const;

/** A managed session's identity (command.ts sessionEnv); a picker started from its shell must not pass it on. */
export const INHERITED_MM_VARS = ['MM_ROLE', 'MM_SESSION_ID', 'MM_PARENT_ID', 'MM_VOICE'] as const;

/** What the tab script clears first. MM_ROSTER_DB too: a cluster sets its own, the main team must use the global one. */
export const FRONT_DESK_CLEARED_VARS = [...INHERITED_CLAUDE_VARS, ...INHERITED_MM_VARS, 'MM_ROSTER_DB'] as const;

export interface FrontDeskOptions {
  /** The cluster folder, or null for the main team (global roster, opened in the plugin folder). */
  cluster: string | null;
  pluginDir: string;
  wtPath: string;
  remote: boolean;
}

const NAME = 'mm-front-desk';

/** The script the front desk tab runs: it sets its own environment, so it holds however the tab was opened. */
export function frontDeskScript(opts: FrontDeskOptions): string {
  const claudeArgs = ['-n', NAME];
  if (opts.remote) claudeArgs.push('--remote-control', NAME);
  claudeArgs.push('--plugin-dir', opts.pluginDir, '--dangerously-skip-permissions', '/multi-manager:front-desk');
  return [
    `$ErrorActionPreference = 'Continue'`,
    `foreach ($mmName in @(${FRONT_DESK_CLEARED_VARS.map(psQuote).join(', ')})) { Remove-Item -LiteralPath "env:$mmName" -ErrorAction SilentlyContinue }`,
    // Full-screen layout for this session only, so the Multi-Manager pane docks beside the chat.
    `$env:CLAUDE_CODE_NO_FLICKER = '1'`,
    ...(opts.cluster === null ? [] : [`$env:MM_ROSTER_DB = ${psQuote(clusterDbPath(opts.cluster))}`]),
    `Set-Location -LiteralPath ${psQuote(opts.cluster ?? opts.pluginDir)}`,
    `& claude ${claudeArgs.map(psQuote).join(' ')}`,
    '',
  ].join('\n');
}

/**
 * The wt.exe command that opens a front desk in a new Terminal window. The tab runs pwsh with an
 * encoded script (as architect/developer launches do): a running Windows Terminal does not reliably pass
 * the caller's environment to a new tab, and base64 survives paths with spaces and parentheses.
 */
export function frontDeskCommand(opts: FrontDeskOptions): { file: string; args: string[]; rosterDb: string | null } {
  const tab = ['-w', 'new', 'new-tab', '--title', NAME, '-d', opts.cluster ?? opts.pluginDir].map(escapeForWt);
  return {
    file: opts.wtPath,
    args: [...tab, 'pwsh', ...PWSH_ARGS, encodeCommand(frontDeskScript(opts))],
    rosterDb: opts.cluster === null ? null : clusterDbPath(opts.cluster),
  };
}

/** The environment for wt.exe: the caller's, minus only the inherited Claude and session-identity variables (Windows names ignore case). */
export function frontDeskEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const drop = new Set<string>([...INHERITED_CLAUDE_VARS, ...INHERITED_MM_VARS]);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !drop.has(key.toUpperCase())));
}

export interface FrontDeskChild {
  once(event: 'error', listener: (err: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type FrontDeskSpawn = (file: string, args: string[], options: SpawnOptions) => FrontDeskChild;

export interface FrontDeskRunDeps {
  spawn: FrontDeskSpawn;
  env: NodeJS.ProcessEnv;
  wtPath: string;
  /** Where failure reasons go (the picker shows them). */
  error: (message: string) => void;
}

const USAGE = 'usage: front-desk-launch.ts (--folder <dir> | --main) --plugin-dir <dir> [--remote]';

/**
 * scripts/front-desk-launch.ts: opens the front desk and resolves to the exit code, 0 only once wt.exe
 * has exited 0. Every failure reports its reason through deps.error.
 */
export async function runFrontDeskLaunch(argv: string[], deps: FrontDeskRunDeps): Promise<number> {
  const fail = (message: string): number => {
    deps.error(message);
    return 1;
  };
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        folder: { type: 'string' },
        main: { type: 'boolean', default: false },
        'plugin-dir': { type: 'string' },
        remote: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (err) {
    return fail(`${(err as Error).message}\n${USAGE}`);
  }
  const pluginDir = values['plugin-dir'];
  const folder = values.folder;
  if (!pluginDir || (folder === undefined) === !values.main || folder === '') return fail(USAGE);
  if (folder !== undefined) {
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return fail(`The folder does not exist: ${folder}`);
    try {
      ensureClusterDir(folder);
    } catch (err) {
      return fail(`Could not prepare ${join(folder, '.multi-manager')}: ${(err as Error).message}`);
    }
  }

  const { file, args } = frontDeskCommand({ cluster: folder ?? null, pluginDir, wtPath: deps.wtPath, remote: values.remote });
  // The front desk lives in its own Terminal window. wt.exe hands the tab over and exits; its exit code says
  // whether that worked (as the architect launch checks). Detached, so the tab never depends on this process.
  // Never unref() the child: it is the only thing keeping Node alive until wt.exe exits, and without it a
  // top-level await of this promise ends with exit code 13 before the result arrives.
  return new Promise<number>((resolve) => {
    let child: FrontDeskChild;
    try {
      child = deps.spawn(file, args, { env: frontDeskEnv(deps.env), stdio: 'ignore', detached: true });
    } catch (err) {
      resolve(fail(`Could not start Windows Terminal (${file}): ${(err as Error).message}`));
      return;
    }
    child.once('error', (err) => resolve(fail(`Could not start Windows Terminal (${file}): ${err.message}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(0);
      else resolve(fail(`Windows Terminal (${file}) exited with ${code === null ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}
