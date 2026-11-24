# 027 — Fresh start for big, idle managers

Goal #2. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/027-fresh-context-for-managers.return.md` on that branch.

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
`src/monitor/` (activity or a new context-size reader, enforce/monitor), `src/roster/tools-health.ts`, `src/roster/tools-recovery.ts`, `src/roster/projects.ts` plus a schema change for the new project setting, `src/launch/command.ts` (only if the environment variable is supported), `briefings/architect.md` and `briefings/project-manager.md` (a short line on fresh starts), with matching tests.

Shares `hooks/register.tsx` and the health code with task 026, so it runs after 026 is merged, never alongside it.

## Out of scope
Changing how architects write their notes (they already keep them). Developer sessions. The front desk's own context.

## Test scope
The new test files, plus `node --test test/recovery.test.ts test/monitor-enforce.test.ts test/health.test.ts test/projects.test.ts test/command.test.ts`, then `npm run typecheck` and `npm run lint`. Never run the full suite.

## Evidence required
Test summary lines. An end-to-end run in a throwaway project with a low limit (e.g. 40k):
- An idle architect over the limit writes its note and restarts with a small context. Show the context size before and after.
- It carries on correctly when an item arrives.
- An idle architect past a short `idle_stop_minutes` is stopped, then comes back when an item is raised to it.
