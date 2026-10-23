# 005 — Pick up a tab's process and conversation when the launch could not

Goal #15. Branch: `worktree-mm-multi-manager-main-dev-005-late-pid`. Return report: `docs/multi-manager/tasks/005-late-pid.return.md` on that branch.

## Goal
Found in the architect's click-through (2026-10-23): the first time Claude Code opens a folder it stops at a "trust this folder?" prompt. The launcher waits 30 s for the new tab's `claude.exe` (`waitForPid` in `launchTab`, `src/launch/launcher.ts` ~line 169), gives up with the warning "…its process id was not found yet…", and the session row keeps `pid = NULL` and `claude_session_id = NULL` for good:
- the monitor skips it (`refreshConversationIds` and the death check only look at rows with a pid), so its conversation is never recorded and its death is never noticed;
- a model change then relaunched it **without** its conversation ("No saved conversation id for mm-alpha-main, so it starts a fresh conversation"), and a crash restart would do the same.

After this task:
1. Each monitor tick (`src/monitor/monitor.ts`, the tick around line 280) first looks up the live process, by session name, for every running architect/developer row whose `pid` is NULL (`findLivePid` in `src/launch/runner.ts`, or the existing lookup the monitor already has access to), and records the pid. The existing conversation-id refresh then fills in `claude_session_id`. Only a process whose session file names this session counts (same rules as `findLivePid`); never guess.
2. `changeSessionModel` (`src/launch/launcher.ts`): if the row has no conversation id but the process it is about to close is found, read the conversation id from that process (`deps.readClaudeSessionId`) **before** closing it, record it, and resume with it.

## Tests first
- Monitor: a running developer with `pid` NULL and a live claude process for its name → after one tick its `pid` and `claude_session_id` are recorded; a NULL-pid row whose name has no live process stays NULL and nothing else changes; a process for a different name is ignored.
- `changeSessionModel`: row with `pid` NULL and `claude_session_id` NULL, `findPid` finds the process, `readClaudeSessionId` returns a conversation → relaunch carries `--resume <that id>` and `resumed: true`.

## Files expected to change
`src/monitor/monitor.ts` (and its deps type if the lookup must be injected), `src/launch/launcher.ts` (`changeSessionModel` only), tests in `test/monitor*.test.ts` and `test/change-model.test.ts`.

## Out of scope
- Making Claude skip the trust prompt, or changing the 30 s launch wait.
- Do not touch the live roster database or any running session; tests use temp databases and fakes only.

## Test scope
The touched test files with `node --test`, `npm run typecheck`, `npm run lint`. Not the full suite.

## Evidence required
Each command with its summary lines pasted verbatim.
