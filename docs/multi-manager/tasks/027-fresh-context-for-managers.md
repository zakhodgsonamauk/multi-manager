# 027 — Fresh start for big, idle managers

Goal #2. Branch: `worktree-mm-multi-manager-usage-efficiency-dev-027-fresh-context`. Return report: `docs/multi-manager/tasks/027-fresh-context-for-managers.return.md` on that branch.

## Goal
About 79% of estimated usage over the last 14 days was the model re-reading conversations it had already read. Architects average about 380k tokens of conversation per call and project managers about 440k, often 800k; architects live up to 80 hours and project managers up to 202 hours. Only about 65-70k of that is start-up text; the rest is old conversation. Architects already keep everything they need to carry on in files (`status.md`, `progress.md`, task files), so most of that old conversation is dead weight.

After this task, an architect or project manager that is idle and whose conversation has grown past a size limit is restarted with a fresh conversation that resumes from its written notes. The default limit is 200k tokens (a project setting, like `idle_stop_minutes`). The idle auto-stop also starts working.

Within these limits, the design is the developer's call:
- Read the context size from the session's transcript (the latest assistant call's input + cache read + cache write tokens). The extraction script in `docs/multi-manager/usage-efficiency/measure/extract.js` shows how.
- Only restart a session that is idle and has nothing in flight that needs its memory. That means no answered item it has not read, and it is not mid-review. Before the restart, the session gets one model turn telling it to write its resume note to `progress.md` and update `status.md`, and to reply when done. Then the system restarts it. Reuse `restart_architect` and the restore code in `src/roster/tools-recovery.ts`, and check how they pass the start prompt.
- The fresh session's start prompt tells it to resume from `status.md` and `progress.md` and not redo work. Its developers keep running.
- Idle auto-stop: today it is only reported to the front desk, it covers architects only, and it skips any architect whose workstream has a live goal (`src/roster/tools-health.ts:130-142`). Make it do this:
  - Cover project managers as well as architects.
  - Act in code. Stop a manager that has been idle past `idle_stop_minutes` and has no running developers and nothing open addressed to it, even when its goal is still waiting on the user.
  - Bring a stopped manager back automatically, from its notes, when a roster item is addressed to it.
  - If bringing it back automatically turns out to be too big for one sitting, report that early. The architect will split it.
- Also check whether Claude Code honours an environment variable that lowers the automatic-summary threshold for a launched session. If it does and it works in a real launch, set it for architects and project managers in `src/launch/command.ts` as a second safety net. If it is not supported, say so in the return report and do not add it.

## Tests first
- The context-size reader returns the latest call's total from a sample transcript and handles an empty or missing transcript.
- The refresh decision: below the limit gives "no restart". Over the limit but busy gives "no restart". Over the limit, idle and clean gives "write note, then restart". Over the limit with an unread answered item gives "no restart".
- The idle-stop decision covers project managers. It stops a manager whose goal is awaiting sign-off once it is idle past the limit with no running developers. It does not stop one with a running developer.
- An item raised to a stopped manager triggers its restore.

## Files expected to change
`src/monitor/` (activity or a new context-size reader, enforce/monitor), `src/roster/tools-health.ts`, `src/roster/tools-recovery.ts`, `src/roster/projects.ts` plus a schema change for the new project setting, `src/launch/command.ts` (only if the environment variable is supported), with matching tests.

Do NOT edit any of these files: `briefings/architect.md`, `briefings/developer.md`, `commands/plan-goal.md`, `src/launch/launcher.ts`, `test/launcher.test.ts`. They have someone else's unsaved edits in the project folder. The restart prompt itself must tell the fresh session what it needs: resume from `status.md` and `progress.md`. Any briefing line about fresh starts is added later by task 028.

The user signed off a 200k-token default for the limit (roster item #2).

The fix to idle measurement is now part of this task. `readActivity` (`src/monitor/activity.ts:90`) counts the transcript's modified time as activity, so a session's own timer check-ins keep it looking busy forever. A check-in turn that the system starts must not count as the session's own activity for idle detection. Pick the cleanest signal you can observe, and test it.

This task runs before 026, the code-side check-ins. They share the health code, so 026 starts only after this one is merged.

## Out of scope
Changing how architects write their notes (they already keep them). Developer sessions. The front desk's own context.

## Test scope
The new test files, plus `node --test test/recovery.test.ts test/monitor-enforce.test.ts test/health.test.ts test/projects.test.ts test/command.test.ts`, then `npm run typecheck` and `npm run lint`. Never run the full suite.

## Evidence required
Test summary lines. An end-to-end run in a throwaway project with a low limit (e.g. 40k):
- An idle architect over the limit writes its note and restarts with a small context. Show the context size before and after.
- It carries on correctly when an item arrives.
- An idle architect past a short `idle_stop_minutes` is stopped, then comes back when an item is raised to it.

## Send-back round 1 (2026-11-24)
From the outside review of e54ce0f. The focused tests pass, but these defects can lose work or run two copies of a manager.

1. **Restart can open a second copy of a live manager.**
   - Where: `src/monitor/lifecycle.ts:145-147` calls `restartArchitect`. In `src/launch/launcher.ts:438-442` that function opens a new tab even when it could not prove the old process was the session's, or when the kill failed. `changeSessionModel` refuses in exactly that case.
   - Fix: before acting, check in `lifecycle.ts` that the process belongs to the session. If it does not, or the kill fails, skip and report. Do not edit `launcher.ts` unless you must, and say so if you do.
   - Idle stop has the same gap: `lifecycle.ts:177` records `idle_stopped_at` even when `killed` is false. Record it only when `killed` is true.
   - Fix the test fakes too: today they return `ownsProcess: false` and still count that as success.
2. **Real work can be counted as timer activity.**
   - Where: `src/monitor/transcript.ts:38` carries the turn origin forward until a line with `turnOrigin` arrives. In real transcripts, a message from another session (for example a developer's "Task 281 is done") often starts a new turn that has no `turnOrigin`. The manager's whole review then counts as timer activity, so a busy manager can be stopped or asked for its notes.
   - Fix: a user line that is not a tool result, not `isMeta`, and has no `turnOrigin` starts the session's own turn.
   - Add a test built from that real line pattern: a timer turn, then an untagged peer message, then tool calls.
3. **Stop-then-restore loop.**
   - Where: idle stop ignores `info` items, but bring-back counts them (`lifecycle.ts:229`), and both run in the same pass. A manager with an open info item is stopped and relaunched in every pass.
   - Fix: use one definition of "something waiting" for both. Never restore a session in the same pass that stopped it.
4. **Old marks are never cleared.**
   - `idle_stopped_at` survives a manual `restart_architect`, a `stop_architect`, and a pause and resume. So a manager the user stopped on purpose comes back by itself, and a pause-resume relaunch can race it into a duplicate.
   - Fix: only a manager stopped by the idle stop may be brought back. Clear `idle_stopped_at` whenever the session is running or was stopped any other way. Never restore while paused.
   - Also, `refresh_requested_at` never expires (`src/roster/tools-health.ts:148`), so the digest never goes quiet if the note never comes. Expire the request after a set time (your choice, e.g. 30 minutes), or when the context drops below the limit, or when the session restarts.
5. **Saved conversation id cleared too early.** `lifecycle.ts:146` clears it before `restartArchitect`, which can still throw. Clear it only after every guard has passed.
6. **The automatic-summary setting must not go above the model's own limit.** For a manager on a model with a smaller context, `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` must never raise the summary point above that model's limit. Check what the setting does when the model's window is smaller, and cap it if needed. Note the finding in the report.

Missing tests to add, one each:
- an untagged peer message after a timer turn;
- a failed or unowned kill, for both restart and idle stop;
- no stop-then-restore loop on an `info` item;
- a manager the user stopped stays stopped when an item arrives;
- no restore while paused;
- reading the tail of a transcript larger than 6 MB.

Main moved on: tasks 030 and 028 are merged, and `src/roster/tools.ts` and `src/roster/items.ts` changed. Do not pull them in yourself; I will handle conflicts at merge. Update the return report, then raise `done` again.
