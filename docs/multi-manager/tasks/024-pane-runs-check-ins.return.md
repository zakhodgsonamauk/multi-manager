# 024 — return report (round 1)

Branch: `worktree-mm-multi-manager-front-desk-items-dev-024-pane-check-ins`. Last commit: `bead13b` (code and tests); this report is committed after it.

## What changed
Quiet check-ins now leave nothing in the chat: the panel runs them itself.
- `hooks/register.tsx`: the panel's 15-second loop calls `maybeCheckIn`. Ten minutes after it took over (then every ten minutes after each start) it asks `front_desk_digest` (same 4-second limit and `since` rule as before) and judges it with `decideTick`.
  - Quiet / nothing new / paused: band shows "Last check HH:MM — …". No command, no prompt, nothing in the chat.
  - News: `$.command.run({ command: 'multi-manager:tick' })`. The digest is stashed; the `prompt.submit` hook attaches `digestContext` when the tick arrives with origin `{ kind: 'plugin', name: 'multi-manager' }`, and records fingerprint and time only once that prompt went in.
  - Any doubt (roster away, tool missing, 4 s timeout, odd answer, a throw): the check-in runs without a digest.
  - `$.command.run` rejects: fallback `$.prompt.submit({ text: '/multi-manager:tick', asUser: true })`.
  - Never stacks: a check-in the panel started blocks the next until `$.command.run` resolves, or 30 minutes pass. A throw inside the loop is swallowed, later check-ins still run.
- `tool.call` on `CronCreate`: in the front desk (not another role), a prompt starting `/multi-manager:tick` is refused with "No timer needed: the Multi-Manager panel runs the front desk's check-ins itself … Do not arm a timer and do not retry." Other timers and other roles pass. Without the mod, nothing refuses (automatic fallback).
- A scheduled tick that still arrives: the first one passes once with a note to `CronList` and `CronDelete` its tick job; later ones keep 022's digest-judged drop.
- `hooks/roster-view.ts`: `isPanelTick`, `isTickTimerPrompt`, the two texts.
- `briefings/front-desk.md` step 3: two sentences on the pane running check-ins and the refused timer. Claimed and released. File stays under the 7500-character test cap (7437).
- Tests: 10 new in `mod-test/front-desk-pane.test.tsx`; the older tick tests now first send one scheduled tick to use up the "delete your timer" note.

## Tests run
- `npm run test:mod` → ` 73 pass` / ` 0 fail` / `Ran 73 tests across 3 files. [4.18s]`
- `npm run typecheck:mod` → only the 3 known BAND errors (`isCollapsed` missing, `mod-test/front-desk-pane.test.tsx(340,33)`, `(355,33)`, `(389,33)`). No new errors. (I copied the gitignored `.claude-plugin/types` from the project folder into this temporary copy to run it.)
- `npm run lint` → `eslint .` with no output (clean).
- `node --test test/briefings.test.ts test/plugin-manifest.test.ts test/hooks-config.test.ts` → `ℹ tests 21` / `ℹ pass 21` / `ℹ fail 0`.

## Screenshots (opened and judged)
None. Mod-test only; no click-through run (needs a live front desk).

## Decisions made
Logged in `docs/multi-manager/front-desk-items/decisions.md` (Task 024 entry): first scheduled tick passes once unjudged with the note; pending guard and 30-minute limit; digest stashed in module state; fallback prompt form.

## Gaps
- Unverified live: whether `$.command.run` resolves when the tick turn ends or when it is queued, and whether the plugin-origin tick really reaches my own `prompt.submit` hook for a markdown command (types say it runs "through every hook but the calling one"; a clock callback is not a hook). The kit cannot raise the tick prompt from a hook, so tests submit it by hand after the command ran. If the tick does not reach `prompt.submit`, the digest would not ride along; worth one live look (watch the next real check-in).
- Fallback path (`$.command.run` rejects) is not tested: the kit swallows a throwing hook instead of rejecting the call. Which of command or prompt works live is unknown; the fallback prompt uses `asUser: true` so the slash command is read as typed. Unverified that a plugin prompt expands a slash command.
- Module state (`nextCheckIn`, pending digest, timer-note flag) resets on a plugin reload: next check-in is then 10 minutes after reload, and the timer note may show once more.
- Nothing reloaded or restarted.

---

# Round 2 (send-back round 1)

Last commit: see `git log` on the branch (round 2 commit "fix: ...").

## What changed
1. **Fingerprint kept without the hook.** `runCheckIn` now records `lastTick` (fingerprint and the asked time) from the stash once `command.run` resolves, if the prompt hook has not. A flag on the stash (`isRecorded`) makes it written once. The stash stays so the hook can still attach the digest if the tick arrives later.
2. **Loop heartbeat.** The 15-second loop (`loopTick`) writes `lastLoopAt` each turn. `CronCreate` is refused, and the "delete your timer" note sent, only when the heartbeat is under 2 x 15 s old. If a scheduled tick arrives while the loop is stale: loop cancelled and restarted, tick judged as in 022, no delete note. A session in another role no longer beats, polls or runs check-ins.
3. **Throw test made real.** A new fake makes every band update throw during one due check-in; the next due check-in still runs.
4. **Briefing** reworded as asked (try to arm; if refused saying the panel runs check-ins, arm none, do not retry). 7343 characters, cap 7500.
5. **Found by the rejection test, fixed:** the host refuses a prompt that starts with "/" ("would run a command as the user"). My round 1 fallback `$.prompt.submit({ text: '/multi-manager:tick' })` would always have failed. The fallback is now a plain-words prompt ("The Multi-Manager check-in is due. Run the multi-manager:tick command now (the Skill tool, skill ...)") with the digest in its own text; fingerprint is recorded the same way.

## Tests run
- `npm run test:mod` -> ` 76 pass` / ` 0 fail` / `Ran 76 tests across 3 files. [4.65s]`
- `npm run typecheck:mod` -> only the 3 known BAND errors (lines 346, 361, 395 `isCollapsed` missing). No new ones.
- `npm run lint` -> `eslint .`, no output (clean).
- `node --test test/briefings.test.ts test/plugin-manifest.test.ts test/hooks-config.test.ts` -> `ℹ tests 21` / `ℹ pass 21` / `ℹ fail 0`.
New tests: no-`panelTick` keeps the fingerprint (same news ten minutes later starts no second command; a later tick still gets the digest); command rejected (no `command.run` hook: the kit does reject) -> plain prompt with digest, not repeated; stopped loop -> `CronCreate` passes, scheduled tick restarts the loop with no note; one failure inside a check-in does not stop later ones.

## Decisions made
Logged in `docs/multi-manager/front-desk-items/decisions.md`: heartbeat window 2 x 15 s; plain-words fallback prompt; other-role sessions do not beat.

## Gaps
- Still unverified live: whether `$.command.run` resolves at queue time or turn end (the guard and the 30-minute limit cover both), and whether the Skill tool can run `multi-manager:tick` for the fallback prompt.
- The stopped-loop test stops the beat through a role change (the kit cannot cancel an interval); it exercises the same check (`lastLoopAt` too old).
- Nothing reloaded or restarted.
