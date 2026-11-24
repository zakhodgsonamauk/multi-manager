# 026 — Check-ins that cost nothing when nothing happened

Goal #2. Branch: `worktree-mm-multi-manager-usage-efficiency-dev-026-quiet-checkins`. Return report: `docs/multi-manager/tasks/026-quiet-checkins-without-model.return.md` on that branch.

## Goal
Architects and project managers each set a 10-minute timer that runs `/multi-manager:tick` as a full model turn. Measured over the last 14 days: 5,831 ticks, about 17% of all estimated usage; 89% of them only checked status and found nothing to do. Every tick re-reads the whole conversation (typically 400k-700k tokens on Opus), so an idle architect costs about $3.70 an hour just ticking (estimate at list prices).

After this task, the "is anything wrong?" check for architects and project managers runs in code, and a model turn starts only when there is something to act on: a developer or architect whose `recommended_action` is not `none`, or an unseen roster item addressed to or watched by that session. The front desk already works this way: its pane asks the roster for a digest and swallows quiet check-ins without a model turn (`hooks/register.tsx`, around lines 351-424, `decideTick`). Extend the same idea to architects and project managers, and remove the self-armed cron timer from their instructions.

Design is the developer's call within these limits:
- Preferred: the plugin's mod (`hooks/register.tsx`, loaded in every Multi-Manager session) runs a quiet check for architect and project-manager sessions too, using a new roster digest for that session's scope (its developers or architects, plus its unseen items). Only when the digest has something to act on does it start the `/multi-manager:tick` turn, with the digest attached, like the front desk's.
- Acceptable alternative: the roster monitor that already runs in code every 30 seconds in the front desk's roster server (`src/monitor/monitor.ts`, `startMonitor` in `src/roster/server.ts:27`) sends the architect or project manager a nudge only when its scope has something to act on.
- Either way, a session with nothing to act on gets zero model turns from the check-in.
- The briefings and commands that tell architects and project managers to `CronCreate` a `/multi-manager:tick` job (and to re-arm it, and to delete it on pause) are changed to say the check-in is automatic. The pause/resume flow must still stop work starting during a pause.
- Fix the idle measure while here: `readActivity` (`src/monitor/activity.ts:90`) counts the transcript's modified time as activity, so a session's own check-in turns keep it "active" forever. Once quiet check-ins no longer create turns this mostly fixes itself; make sure a check-in turn the system started does not count as the session's own activity for stuck or idle detection.

UPDATE 2026-11-24: task 027 is merged (`02cce66`) and already includes the idle-measure fix. Build on its code: `src/monitor/lifecycle.ts`, `src/monitor/transcript.ts`, and `refresh_due` in `front_desk_digest` (`src/roster/tools-health.ts`). Task 028 is merged too: the front desk acts on `refresh_due` through `commands/tick.md`.

Extra items folded in from the 027 review:
1. Hand the "write your note" request to the manager directly. When an architect or project manager has its own quiet check-in (this task), its digest should carry its own `refresh_due` entry. The manager can then act on it with no help from the front desk. Keep the front-desk route as the fallback for sessions where the mod is not loaded.
2. Fix a failed kill during idle stop (`src/monitor/lifecycle.ts:232-236`). When ownership is proven but the kill fails, `stopSession` has already removed the session's settings and tool-connection files and released its claims, and the row is then marked running again without them. Fix: kill first and check the exit code, as `replaceWithFresh` does. Only after a successful kill, call `stopSession` for the clean-up. Add a test.
3. The 30-minute request expiry re-asks in the same pass (`lifecycle.ts:249-252`), so the digest never goes quiet for a manager that ignores the request. After an expiry, do not ask again for a cool-down period (your choice, for example 2 hours), so the digest goes quiet. Add a test.

## Tests first
- A digest for an architect's scope: quiet when its developers are all `none` and it has no unseen items; not quiet when a developer needs `nudge`/`restart`/`report` or an item addressed to it is unseen. Same for a project manager over its architects and watched items.
- The quiet-check decision for an architect session: quiet digest gives "no turn"; non-quiet gives a turn carrying the digest; a repeat of the same digest fingerprint does not start a second turn.
- Briefings test (`test/briefings.test.ts`): architect and project-manager briefings no longer tell the model to `CronCreate` a tick job.
- Idle/stuck detection ignores check-in turns started by the system (pick the cleanest observable signal and test it).

## Files expected to change
`hooks/register.tsx`, `src/roster/tools-health.ts` (or a new digest tool beside it), `src/monitor/activity.ts`, `src/monitor/health.ts` if needed, `commands/tick.md`, `briefings/architect.md`, `briefings/project-manager.md`, any command that arms or deletes the timer (grep for `CronCreate` and `CronDelete` in `briefings/` and `commands/`), matching tests in `test/`.

Those unsaved edits were committed as `528e3d7`.

## Out of scope
Context size and restarting sessions (task 027). Start-up context and plugins loaded (task 029). The front desk's own pane behaviour, beyond reusing its code. Developer sessions (they have no timer).

## Test scope
`node --test test/briefings.test.ts test/front-desk-digest.test.ts test/health.test.ts test/monitor.test.ts` plus any new test files, `npm run typecheck`, `npm run lint`, and `npm run check:mod` for the mod. Never the full suite.

## Evidence required
Test summary lines. A short end-to-end run in a throwaway project: an architect with one idle developer sits 30+ minutes with zero model turns from check-ins (show the transcript turn count before and after), then a roster item addressed to it starts exactly one turn that handles it.

## Send-back round 1 (2026-11-24)
From the outside review of 9c40235. The role detection, the missing-tool fallback, the `CronCreate` block and the pause handling all passed. Fix these:

1. **A stuck developer gets one nudge, then nothing.**
   - The fingerprint (`src/roster/tools-health.ts:237-238`) is `a${id}:${action}` only. After the first nudge the action stays `nudge`, so `decideTick` (`hooks/roster-view.ts:461`) drops every later check as "nothing new", and the developer never reaches `restart`. The old tick nudged, nudged again, then restarted.
   - Fix: put the nudge count in the fingerprint (`a${id}:${action}:${nudges}`), or treat a `nudge` row as new again once its last nudge is at least 10 minutes old.
   - Also clear the stored fingerprint when a check is dropped because of a pause, so a problem shown before the pause gets a turn again after resume.
2. **The check-in text match catches real work** (`src/monitor/transcript.ts:23,53`).
   - The regex runs on any non-`human` user line before the origin is read. It matches compaction summaries (`isCompactSummary`), `task_notification` lines, meta lines, and messages from other sessions that quote the tick. After a mid-turn automatic summary, the rest of that turn stops counting as the session's own work, which feeds idle stop. It also breaks 027's rule for untagged peer messages.
   - Panel ticks are tagged: `"origin":{"kind":"plugin","name":"multi-manager"}` and `turnOrigin:"system"`.
   - Fix: match on that origin. Keep a text fallback only if it is anchored to the start of the line (`<command-message>multi-manager:tick` or the fallback prompt's opening words). Never treat compaction summaries, task notifications or other meta lines as check-in starts.
3. **A long busy turn can queue two tick turns** (`hooks/register.tsx:452-453`).
   - `$.command.run` waits behind the current turn. After `CHECK_IN_PENDING_MAX_MS` (30 min) a second check runs and passes, because `lastTick` is unchanged. It also overwrites `pendingDigest`, so the queued ticks carry the wrong digests. Architects are often busy for more than 30 minutes.
   - Fix: never start a second check while the first `command.run` has not resolved, or compare against the fingerprint already stashed.
4. **The column migration can race** (`src/monitor/lifecycle.ts:277-278`). Each manager has its own roster server, so two can run `ALTER TABLE` at once. Catch the "duplicate column" error and carry on.
5. **A process that exited by itself stays marked running** (`lifecycle.ts:310-315`). If the process is already gone when the kill runs ("no running instance"), treat that as stopped, not as a failed kill.
6. **Wording.** `TIMER_REFUSAL` and `TIMER_NOTICE` say "front desk" when shown to managers. Make the wording fit each role.

Missing tests, one each:
- A stuck developer gets a second check-in turn after the first nudge, and later escalates to `restart`.
- After a resume, a problem shown before the pause gets a turn again.
- Real transcript line shapes: a compaction summary, a task notification and a peer message that mention the tick all count as the session's own work, and a line with `origin.kind:"plugin"` does not.
- A turn busy for more than 30 minutes ends with one tick, not two.
- The migration runs safely on a database that already has the column.

The live 30-minute run is no longer yours to do. The architect does it at wrap-up. Never run headless `claude -p`. Update the return report, then raise `done` again.

## Send-back round 2 (2026-11-24)
The re-review confirmed all six round-1 points as fixed. One new defect, plus two small fixes:

1. **Check-ins can stop for good** (`hooks/register.tsx:456`).
   - `if (isCommandInFlight) return` now has no time limit. If `$.command.run` never resolves (the command is lost or cancelled), check-ins stop forever in that session. The front desk shares this code, so it is affected too.
   - Fix: give the in-flight wait its own longer limit (2 hours), or clear the flag when the tick reaches `prompt.submit` or the session goes idle.
   - Test 1: a lost command stops blocking after the limit.
   - Test 2: a slow one is still never doubled.
2. **Escalation test is too loose.** It checks `!== 'nudge'`. Make it check for `'restart'` exactly.
3. **Front-desk fingerprint.** Add the nudge count to `front_desk_digest`'s fingerprint too, as in `manager_digest`, so the front desk can't hit the same stall.

Update the return report, then raise `done` again.
