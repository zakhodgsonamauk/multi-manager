# 007 return: the launcher makes each developer's copy itself

## What changed
- New `src/launch/dev-copy.ts`: `ensureDevCopy({projectFolder, name, baseBranch})` uses git (`spawnSync`, argument arrays, no shell) and returns the copy folder.
  - Copy folder exists: returned untouched (restart, model change).
  - Else `base` branch missing locally: refused, naming it.
  - Else branch `worktree-<name>` exists: reused only if `git rev-list --count <base>..<branch>` is 0, otherwise refused naming the branch; never reset or deleted.
  - Else `git worktree add -b worktree-<name> <project>/.claude/worktrees/<name> <base>`.
  - Any git failure throws with git's own output. Not a git repo also throws.
- `LaunchDeps.ensureDevCopy` (optional, so the many existing fake deps stay pure; `realDeps()` supplies it). Without it a developer just opens in the project folder.
- `launchTab` makes the copy first for developers, before registering anything, so a refusal leaves no new session and opens no tab. For a relaunch (`reuse`), the session is set to `stopped` on refusal (changeSessionModel's own catch also does this).
- `--worktree` removed from `claudeArgs`, `LaunchSpec`, `TabSpec`, `launchDeveloper`, `changeSessionModel`.
- The session row's `folder` is still the project folder; only the tab folder (`-d`, wrapper `Set-Location`) is the copy.
- `commands/dispatch.md` step 2: one sentence saying the copy starts from the workstream branch. Briefings had no text about `--worktree` or the remote, so unchanged.

## Before / after
- claudeArgs, developer: `... --dangerously-skip-permissions --worktree <name> --plugin-dir ...` becomes `... --dangerously-skip-permissions --plugin-dir ...`.
- Tab folder, developer: `-d <project folder>` and `Set-Location <project folder>` become `-d <project>\.claude\worktrees\<name>` and the same in `Set-Location`. Architects unchanged.

## Tests
- `node --test test/launcher.test.ts test/launch-model.test.ts test/dev-copy.test.ts test/command.test.ts test/change-model.test.ts test/recovery.test.ts test/briefings.test.ts test/plugin-manifest.test.ts`: all passing (85 for the first six files, 14 for the last two).
- New `test/dev-copy.test.ts` (6 tests, real throwaway git repo in the temp folder, path with space and parentheses): new copy on area branch (not main), reuse untouched (file survives, no new branch), empty leftover branch reused, leftover branch with commits refused and untouched, missing base branch refused with name, not a repo.
- New in `test/launcher.test.ts`: no `--worktree`, tab opens in copy, recorded folder stays project folder; failure opens no tab and leaves the developer stopped; architects make no copy.
- Updated: `change-model.test.ts` and `command.test.ts` no longer expect `--worktree`.
- Written test-first: `dev-copy.test.ts` failed with module not found before `dev-copy.ts` existed.
- `npm run typecheck` and `npm run lint`: clean.

## Unsure / notes
- No separate test for 006's cause: removing `--worktree` is the fix (006 findings). Real end-to-end launch is left to the architect.
- A registered-but-missing worktree (folder deleted by hand, git still remembers it) makes `git worktree add` fail; the error is surfaced as is, `git worktree prune` is not run automatically.
- A leftover branch already checked out in another folder also surfaces git's error.
- Git runs synchronously (a second or two for a big repo).
