# 006 — See why developer tabs die at launch

Goal #10. Done by the architect (no developer: launching a developer is the thing that is broken). Findings go in this file under "Findings".

## Goal
On 2026-11-01 every developer tab launched for tell-me-a-story-2 (roster sessions #6-#13) closed about 2 seconds after it opened, with exit code 1, and no temporary copy was made. Architect tabs from the same launcher start fine. Before anything is changed, get the actual error message the dying tab prints.

## Method
1. Make a separate copy of this project on a new branch `fix/dev-launch` (git worktree under `I:\worktrees\` or the scratchpad), so the live plugin on `main` is never touched. `npm install` there (or a junction to the project's node_modules, removed before the copy is deleted).
2. Make a throwaway git repo (scratchpad) with a `main` and an area branch `area/test`, and a throwaway roster in a cluster folder (its own `roster.db`), with the throwaway repo added as a project whose `test` workstream uses branch `area/test`. The live roster and tell-me-a-story-2 are never used.
3. Launch one developer through the real launcher code from the separate copy (a small node script calling `launchDeveloper` against the throwaway roster), with a task text shaped like the real ones (Windows paths, backticks, a colon, about 600 characters).
4. To read the error: temporarily make the wrapper wait for Enter when claude exits non-zero (diagnostic only, not committed), and screenshot the tab. Also try the same launch without `--worktree`, and with a one-word task, to narrow it down.

## Things to rule in or out
- `claude --worktree` itself under the wrapper (Claude Code updated to 2.1.316 on 2026-10-31; developer launches worked on 2026-10-23 with the same wrapper).
- The task text (quotes, backticks, backslashes, length) reaching claude damaged.
- The kill-on-close Job, or the stripped CLAUDE_CODE_* variables, breaking the git calls `--worktree` makes.

## Evidence required
The exact error text, quoted. The screenshot path, opened and judged. Which variable made it pass or fail.

## Findings
2026-11-01, Claude Code 2.1.316, launched through the real launcher from branch fix/dev-launch against a throwaway roster:
1. Throwaway repo in the scratchpad (never trusted): tab exits 1 in ~3 s. Screen text: "Error creating worktree: Workspace trust not yet accepted. Run `claude` once in this directory and accept the trust dialog, then retry with --worktree." No copy made, no branch made.
2. Throwaway repo under `I:\Dropbox (Personal)\Projects` (a folder Claude already trusts): same error, same exit. So `--worktree` in a launched tab does not take trust from a trusted parent folder.
3. Same trusted-parent repo, same command with `--worktree` removed: tab stays up, no trust question, and the developer checked in to the throwaway roster 20 s after launch.
Not reproduced directly: tell-me-a-story-2 itself (its folder is trusted by exact path, and the rules keep this test out of it). Its symptom (exit 1 after ~2 s, no copy) matches.
Conclusion: Claude Code's own copy-making step (`--worktree`) is what kills the tab. The task text, the wrapper and the kill-on-close Job are not the cause (case 3 used all of them unchanged). Task 007 drops `--worktree`, so it fixes both bugs; the developer's copy must sit under the (trusted) project folder so the tab starts without a trust question.
Incident during this task: closing a probe tab by window title killed the whole Windows Terminal (all sessions). Close test tabs only by their own wrapper process id.
