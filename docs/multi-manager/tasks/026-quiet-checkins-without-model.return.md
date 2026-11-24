# 026 — return report (round 1)

Branch: `worktree-mm-multi-manager-usage-efficiency-dev-026-quiet-checkins`. Last commit: see `git log -1` on the branch (the report is committed last).

## What changed
Architects and project managers no longer run a model turn to ask "is anything wrong?". The mod does it in code every 10 minutes and starts a `/multi-manager:tick` turn only when the answer is yes.

- New roster tool `manager_digest` (`src/roster/tools-health.ts`): for an architect it covers its developers, for a project manager its architects; plus unseen items addressed to it, items it only watches, and its own resume-note request (`refresh_due`). Same shape as `front_desk_digest` (quiet, paused, act_on, refresh_due, new_items, fingerprint). A quiet answer is 81 characters.
- Mod (`hooks/register.tsx`): architect and project-manager sessions now run the same quiet check-in loop as the front desk (no pane, no polling). Quiet or same-fingerprint news: no turn. Paused: no turn. News: one `/multi-manager:tick` turn with the digest attached. A developer session runs nothing. A `CronCreate` of the tick is refused for managers while the loop is alive.
- Briefings (`architect.md`, `project-manager.md`) and `commands/tick.md`: no timer to arm, re-arm or delete; "Arm no timer", with a line to delete an old tick job. Pause: no check-in starts while paused, so nothing restarts work. tick.md acts from the digest and tells the manager to write its resume note when `refresh_due` names it (review item 1; the front-desk route stays as fallback).
- Idle measure (`src/monitor/transcript.ts`): a check-in turn the system started (tick command text, any turn origin except `human`) and its replies are not the session's own activity. Task 027 already handled origin `scheduled`; this covers panel-started turns whose origin is unknown.
- Review item 2 (`src/monitor/lifecycle.ts`): idle stop kills first and checks the exit code; clean-up (`stopSession`) only after a good kill. A failed kill now leaves settings files and claims alone.
- Review item 3: an expired resume-note request is remembered (`refresh_expired_at`, added to the table with a migration for old rosters) and not re-asked for 2 hours (`REFRESH_COOLDOWN_MS`).

## Tests run
All run from the branch folder.

`node --test test/briefings.test.ts test/front-desk-digest.test.ts test/health.test.ts test/monitor.test.ts test/manager-digest.test.ts test/lifecycle.test.ts test/lifecycle-tick.test.ts test/transcript.test.ts test/server.test.ts test/pause.test.ts`
```
ℹ tests 93
ℹ pass 93
ℹ fail 0
```
`node --test test/manager-digest.test.ts`: 8 pass, 0 fail (prints `quiet manager_digest length: 81`).
`node --test test/lifecycle.test.ts`: `ℹ pass 21 / ℹ fail 0` (new: failed kill leaves files and claims; expiry cool-down).
`npm run typecheck`: no errors. `npm run lint`: no errors.
`npm run test:mod`:
```
 84 pass
 0 fail
Ran 84 tests across 3 files.
```
New mod tests (architect and project manager): quiet digest starts no turn over hours and calls only `manager_digest`; news starts one turn with the digest, same fingerprint starts no second, changed fingerprint starts one; paused starts none; developer runs nothing; a quiet hour then an item starts exactly one turn; tick timer refused for managers. I changed two existing tests that used role `architect` to mean "a role that runs no loop" so they use `developer`.
`claude plugin validate .`: `✔ Validation passed with warnings` (README install-line warning, not mine).

## Screenshots (opened and judged)
None: no screen change.

## Decisions made
Logged in `docs/multi-manager/usage-efficiency/decisions.md` (2026-11-24, task 026): mod route not monitor route; watched items listed once by time; check-in turns recognised by their text; idle stop kill order; 2-hour cool-down.

## Gaps
- **Live end-to-end run not done.** The task asks for a 30+ minute run in a throwaway project showing transcript turn counts. I did not do it: it needs a real roster running this branch's code plus two real tabs for over half an hour. What stands in for it: the mod tests above drive the real check-in code on a simulated clock (an hour of quiet = zero turns and zero prompts; then one item = exactly one turn) and the digest tests run on a real roster database. Architect: say if you want the live run and I will do it.
- `npm run typecheck:mod` fails in this folder (296 errors, same count with and without my change): the `claude-code` type package is not installed in this temporary copy. `npm run test:mod` and `claude plugin validate` do pass.
- Not known: what turn origin the host gives a turn the mod starts. That is why the transcript check uses the tick text, not the origin.
- Refusal and delete-note texts still say "front desk's check-ins" when shown to a manager; harmless, not reworded.
- A manager's first check comes one loop turn (15 s) after 10 minutes.
- `pause.ts` still tells managers to "delete your tick timer if you have one"; left as is (harmless, covers old sessions).

## Round 2 (send-back round 1)

Fixed all six points. Live run no longer mine (architect does it at wrap-up).

1. **Stuck developer escalates.** The manager digest's fingerprint now includes the nudge count (`a<id>:<action>:<nudges>`), and each `act_on` row carries `nudges`. After each nudge the digest looks new, so a second and third turn happen, then `restart`/`report`. A paused check now forgets the stored fingerprint (`decideTick`, `hooks/roster-view.ts`), so a problem shown before a pause gets a turn after resume. This also applies to the front desk's check (same function).
2. **Transcript match.** `isCheckInStart` (`src/monitor/transcript.ts`) matches the line's origin `{kind:"plugin", name:"multi-manager"}`. Text fallback only for the OPENING words of a plain line (`<command-message>multi-manager:tick` or "The Multi-Manager check-in is due."), and never for meta lines, compaction summaries, human, peer or task-notification lines.
3. **No doubled tick.** New `isCommandInFlight` flag in `hooks/register.tsx`: no new check while `$.command.run` has not resolved, however long (replaces the 30-minute release for that case). Cost: a command that never resolves blocks check-ins until the session restarts; the old test that expected a second run after 30 minutes now expects none.
4. **Migration race.** `ALTER TABLE` catches "duplicate column" and carries on.
5. **Process gone.** `isProcessGone` (taskkill "not found" / "no running instance") counts as stopped in idle stop and in `replaceWithFresh`.
6. **Wording.** `timerRefusal(isManager)` and `timerNotice(isManager)`: "your check-ins" for managers, "the front desk's" for the front desk.

New tests: stuck developer new fingerprint after each nudge and escalation (`test/manager-digest.test.ts`); pause then resume gets a turn again, one tick for a turn busy over 30 minutes, manager wording (mod tests); transcript shapes: compaction summary, task notification, meta line, peer message and a plain mention all count as own work, plugin origin does not (`test/transcript.test.ts`); migration on an old table and on a database that already has the column, and process-gone idle stop (`test/lifecycle.test.ts`).

Run again from the branch folder:
```
node --test test/briefings.test.ts test/front-desk-digest.test.ts test/health.test.ts test/monitor.test.ts test/manager-digest.test.ts test/lifecycle.test.ts test/lifecycle-tick.test.ts test/transcript.test.ts test/server.test.ts test/pause.test.ts
ℹ tests 98
ℹ pass 98
ℹ fail 0
npm run test:mod
 87 pass
 0 fail
Ran 87 tests across 3 files.
npm run typecheck   (no errors)
npm run lint        (no errors)
```
Gaps now: the live run is the architect's. `typecheck:mod` still fails in this folder at baseline (missing `claude-code` types).

## Round 3 (send-back round 2)

1. **Lost command.** The in-flight wait in `hooks/register.tsx` now has a limit: a tick command that has not resolved after 2 hours (`COMMAND_LOST_MS`) is taken as lost and check-ins carry on. A late-resolving old command only clears its own mark. Mod test: lost one stops blocking after 2 hours (1 h 40 min: still one run; past 2 h: second run). The existing "slow one is never doubled" test (60 minutes on, still one run) stays.
2. **Escalation test** now checks `'restart'` exactly.
3. **Front-desk fingerprint** (`front_desk_digest`) now includes the nudge count, and its `act_on` rows carry `nudges`. New test in `test/front-desk-digest.test.ts`: fingerprint changes after a nudge.

Run again from the branch folder:
```
node --test (the same ten files as round 2)
npm run test:mod   -> 88 pass, 0 fail, Ran 88 tests across 3 files.
npm run typecheck, npm run lint: no errors
```
