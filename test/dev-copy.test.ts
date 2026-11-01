import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ensureDevCopy } from '../src/launch/dev-copy.ts';
import { tempDir } from './helpers.ts';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** A throwaway repo (folder name with a space and parentheses, like the real ones) with main and an area branch one commit ahead. */
function repo(t: TestContext): string {
  const folder = join(tempDir(t), 'My Project (Work)');
  mkdirSync(folder);
  git(folder, 'init', '-q', '-b', 'main');
  writeFileSync(join(folder, 'a.txt'), 'one');
  git(folder, 'add', '.');
  git(folder, 'commit', '-q', '-m', 'one');
  git(folder, 'branch', 'area');
  git(folder, 'checkout', '-q', 'area');
  writeFileSync(join(folder, 'b.txt'), 'two');
  git(folder, 'add', '.');
  git(folder, 'commit', '-q', '-m', 'area work');
  git(folder, 'checkout', '-q', 'main');
  return folder;
}

const NAME = 'mm-alpha-main-dev-login';
const input = (projectFolder: string) => ({ projectFolder, name: NAME, baseBranch: 'area' });

test('a new developer gets a copy under .claude/worktrees on worktree-<name>, started from the area branch, not main', (t) => {
  const folder = repo(t);
  const copy = ensureDevCopy(input(folder));
  assert.equal(copy, join(folder, '.claude', 'worktrees', NAME));
  assert.equal(git(copy, 'rev-parse', '--abbrev-ref', 'HEAD'), `worktree-${NAME}`);
  assert.equal(git(copy, 'rev-parse', 'HEAD'), git(folder, 'rev-parse', 'area'));
  assert.notEqual(git(copy, 'rev-parse', 'HEAD'), git(folder, 'rev-parse', 'main'));
  assert.ok(existsSync(join(copy, 'b.txt')));
});

test('a copy that exists is reused untouched and no branch is created', (t) => {
  const folder = repo(t);
  const copy = ensureDevCopy(input(folder));
  writeFileSync(join(copy, 'wip.txt'), 'unsaved work');
  const branches = git(folder, 'branch', '--list');
  assert.equal(ensureDevCopy(input(folder)), copy);
  assert.equal(readFileSync(join(copy, 'wip.txt'), 'utf8'), 'unsaved work');
  assert.equal(git(folder, 'branch', '--list'), branches);
});

test('a leftover branch with no commits of its own and no folder is reused', (t) => {
  const folder = repo(t);
  git(folder, 'branch', `worktree-${NAME}`, 'area');
  const copy = ensureDevCopy(input(folder));
  assert.equal(git(copy, 'rev-parse', '--abbrev-ref', 'HEAD'), `worktree-${NAME}`);
});

test('a leftover branch with its own commits and no folder is refused and left alone', (t) => {
  const folder = repo(t);
  git(folder, 'checkout', '-q', '-b', `worktree-${NAME}`, 'area');
  writeFileSync(join(folder, 'mine.txt'), 'x');
  git(folder, 'add', '.');
  git(folder, 'commit', '-q', '-m', 'dev work');
  git(folder, 'checkout', '-q', 'main');
  const tip = git(folder, 'rev-parse', `worktree-${NAME}`);
  assert.throws(() => ensureDevCopy(input(folder)), new RegExp(`worktree-${NAME}`));
  assert.equal(git(folder, 'rev-parse', `worktree-${NAME}`), tip);
  assert.ok(!existsSync(join(folder, '.claude', 'worktrees', NAME)));
});

test('a missing area branch is refused with its name and nothing is made', (t) => {
  const folder = repo(t);
  assert.throws(() => ensureDevCopy({ ...input(folder), baseBranch: 'nope/branch' }), /nope\/branch/);
  assert.equal(git(folder, 'branch', '--list', `worktree-${NAME}`), '');
  assert.ok(!existsSync(join(folder, '.claude', 'worktrees', NAME)));
});

test('a folder that is not a git repository gives a clear error', (t) => {
  assert.throws(() => ensureDevCopy(input(tempDir(t))), /git/i);
});

test('a leftover empty branch made from an older version is moved up to the area branch before the copy is made', (t) => {
  const folder = repo(t);
  // As on 2026-11-01: a failed launch left worktree-<name> at an old version (here: main, behind area).
  git(folder, 'branch', `worktree-${NAME}`, 'main');
  const copy = ensureDevCopy(input(folder));
  assert.equal(git(copy, 'rev-parse', '--abbrev-ref', 'HEAD'), `worktree-${NAME}`);
  assert.equal(git(copy, 'rev-parse', 'HEAD'), git(folder, 'rev-parse', 'area'));
  assert.ok(existsSync(join(copy, 'b.txt')));
});
