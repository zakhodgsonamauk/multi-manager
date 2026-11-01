# 007 — The launcher makes each developer's copy itself, from the area's branch

Goal #10. Branch: `fix/dev-launch` (the separate copy made in 006). Return report: `docs/multi-manager/tasks/007-launcher-makes-dev-copy.return.md` on that branch.

## Goal
Two problems with how a developer tab starts:
1. Developer tabs die at launch (see 006's Findings for the cause; fix it here if it is not already gone with point 2).
2. `claude --worktree` bases the developer's temporary copy on the remote's default branch, which was 29 commits behind local `main` on 2026-11-01. A developer must start from its architect's branch: the workstream's `branch` in the roster (`workstreams.branch`).

Fix: the launcher creates the copy itself with git, then opens claude inside it, with no `--worktree`:
- Path: `<project folder>/.claude/worktrees/<session name>` (the same place `--worktree` used, so the monitor's "a developer's copy lives under its project folder" rule still holds).
- Branch: `worktree-<session name>` (same name as before, so architects' habits and review steps keep working).
- Started from the workstream's branch. If that branch does not exist locally, refuse with a plain message naming it; do not fall back to another branch.
- If the copy already exists (restart_developer, a model change), reuse it as it is: never reset, delete or recreate it, and never touch its branch.
- If the branch exists but the copy folder does not (an earlier failed launch left an empty branch, as on 2026-11-01), make the copy on that existing branch only if it has no commits beyond the workstream branch; otherwise refuse with a message naming it, so no work is ever lost.
- The tab opens in the copy's folder (`-d` and `Set-Location`), and the session's recorded folder stays the project folder.
- A git failure throws a clear error before any tab opens, and the session is marked stopped.

## Tests first
In `test/launcher.test.ts` (or a new `test/dev-worktree.test.ts`), using a real throwaway git repo in a temp folder:
- New developer: copy made at `.claude/worktrees/<name>`, on branch `worktree-<name>`, whose latest version equals the workstream branch's (not `main`'s, when they differ).
- The launch command has no `--worktree` and opens in the copy's folder.
- Relaunch (model change / restart) with the copy present: copy untouched (a file written in it survives), no git branch created.
- Leftover empty branch, no folder: copy made on it. Leftover branch with its own commits, no folder: refused, branch untouched.
- Workstream branch missing: refused with its name; no tab opened, session stopped.
Plus whatever test 006's cause needs, failing before the fix.

## Files expected to change
`src/launch/launcher.ts`, `src/launch/command.ts`, a new small git helper in `src/launch/`, their tests. Briefing text only if it tells developers about `--worktree` or where their copy comes from.

## Out of scope
The wrapper's Job and variable stripping (unless 006 shows they are the cause). Architect launches. Deleting copies or branches. Anything in tell-me-a-story-2. Pushing.

## Test scope
`node --test test/launcher.test.ts test/launch-model.test.ts` plus the new test file; `npm run typecheck`; `npm run lint`. No full suite.

## Evidence required
Test summary lines (pass counts). The diff of `claudeArgs` / `buildLaunchCommand`. End-to-end proof is run by the architect afterwards.
