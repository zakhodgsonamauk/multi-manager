import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DevCopyInput {
  /** The project's own folder (where the area branch lives). */
  projectFolder: string;
  /** The session name: the copy's folder name; its branch is `worktree-<name>`. */
  name: string;
  /** The workstream's branch the copy starts from. */
  baseBranch: string;
}

export function devCopyFolder(projectFolder: string, name: string): string {
  return join(projectFolder, '.claude', 'worktrees', name);
}

function git(cwd: string, args: string[]): { code: number; out: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error !== undefined) throw new Error(`Could not run git: ${result.error.message}`);
  return { code: result.status ?? 1, out: `${result.stdout}${result.stderr}`.trim() };
}

function hasBranch(cwd: string, branch: string): boolean {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0;
}

/**
 * Makes (or finds) a developer's own copy of the project and returns its folder. Never loses work: never deletes or
 * recreates anything: an existing copy is returned as it is, and a leftover branch is only reused (moved up to the
 * workstream branch) when it holds no work of its own. Throws a plain error for any refusal or git failure.
 */
export function ensureDevCopy(input: DevCopyInput): string {
  const { projectFolder, name, baseBranch } = input;
  const copy = devCopyFolder(projectFolder, name);
  if (existsSync(copy)) return copy;
  const branch = `worktree-${name}`;
  if (git(projectFolder, ['rev-parse', '--is-inside-work-tree']).code !== 0) {
    throw new Error(`${projectFolder} is not a git repository, so ${name} cannot get its own copy.`);
  }
  if (!hasBranch(projectFolder, baseBranch)) {
    throw new Error(
      `Branch "${baseBranch}" (the workstream's branch) does not exist in ${projectFolder}, so ${name} has nothing to start from. Create it or fix the workstream's branch.`,
    );
  }
  let add: { code: number; out: string };
  if (hasBranch(projectFolder, branch)) {
    const ahead = git(projectFolder, ['rev-list', '--count', `${baseBranch}..${branch}`]);
    if (ahead.code !== 0 || ahead.out !== '0') {
      throw new Error(
        `Branch "${branch}" already exists with work of its own beyond "${baseBranch}", but its folder is gone. Left untouched: restore its folder with git worktree add, or merge or remove the branch, then relaunch.`,
      );
    }
    // No work of its own, so moving it up to the workstream branch loses nothing (a failed launch on 2026-11-01
    // left such branches at the remote's old default branch, behind the area branch).
    add = git(projectFolder, ['worktree', 'add', '-B', branch, copy, baseBranch]);
  } else {
    add = git(projectFolder, ['worktree', 'add', '-b', branch, copy, baseBranch]);
  }
  if (add.code !== 0) throw new Error(`git could not make ${name}'s copy at ${copy}: ${add.out}`);
  return copy;
}
