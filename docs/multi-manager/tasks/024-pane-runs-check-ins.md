# 024 — The panel runs the front desk's check-ins itself, so a quiet one leaves nothing in the chat

Goal #129. Developer #337 (sonnet), tab `mm-multi-manager-front-desk-items-dev-024-pane-check-ins`. Branch: `worktree-mm-multi-manager-front-desk-items-dev-024-pane-check-ins`. Return report: `docs/multi-manager/tasks/024-pane-runs-check-ins.return.md` on that branch.

## Why
Today the front desk's model arms a 10-minute timer (`CronCreate`, prompt `/multi-manager:tick`). Task 022 made the
pane mod drop quiet check-ins in its `prompt.submit` hook (`handleTick` in `hooks/register.tsx`), but Claude Code still
prints two lines for every drop, with no silent form (checked in the API types: a hook's drop reason "is shown to the
user"):

    ✻ Running scheduled task (Nov 10 10:25am)
    ● Prompt dropped by a hook: Multi-Manager check-in, all quiet

The user wants quiet check-ins to leave NOTHING in the chat. The way out: no timer prompt at all while the panel
works. The panel already has its own 15-second loop (`startTimer` / `poll`); it decides when a check-in is due, asks
the roster for the digest itself, and only when something needs the front desk does it start a check-in turn.

## What to build
1. **Panel check-in loop** (front desk only, once `isFrontDesk`). From the existing 15-second loop (or a second
   `$.clock.every` beside it), when 10 minutes have passed since the last check-in the panel ran (first one 10 minutes
   after activation):
   - Call `front_desk_digest` with the same 4-second limit and `since` rule as `handleTick` today, and judge it with
     the existing pure `decideTick`.
   - `drop` (quiet / nothing new / paused): update `lastCheck` and the band ("Last check HH:MM — all quiet"), exactly as
     today. Nothing in the chat, no turn.
   - `pass-with-digest`: start a check-in turn with `$.command.run({ command: 'multi-manager:tick' })`. The digest rides
     along as context: stash it (module state or an atom), and let the `prompt.submit` hook attach `digestContext(...)`
     when it sees the tick come in with origin `{ kind: 'plugin', name: <this plugin> }`. Record fingerprint and time
     only once the tick went in (same as today).
   - Any doubt (roster away, digest tool missing, timeout, odd answer, a throw): run the check-in anyway, without a
     digest (today's "let it through unchanged"). A failure never skips a check-in.
   - If `$.command.run` rejects (Stop, host limit, unknown name), fall back to `$.prompt.submit({ text: '/multi-manager:tick' ... })`
     or a short plain prompt asking the model to run the check-in; say in the return report which works.
   - Never stack check-ins: while one the panel started has not finished, do not start another. Find out from the types
     when `$.command.run` resolves (queued vs turn done) and guard accordingly, with a time limit so a lost promise
     cannot block check-ins for ever.
   - One throw inside the loop must not stop later check-ins.
2. **Retire the model's timer while the panel runs check-ins.**
   - `on('tool.call', { tool: 'CronCreate' }, ...)`: in the front desk (`isFrontDesk`, not another role), a `CronCreate`
     whose prompt starts with `/multi-manager:tick` is refused with a plain reason the model reads, e.g. "The
     Multi-Manager panel runs the front desk's check-ins itself; no timer needed." Any other `CronCreate` passes untouched.
     A refusal must not count as an error the model retries: word it so it stops.
   - A scheduled `/multi-manager:tick` that still arrives (a timer armed before this change, or armed before the panel
     activated): let it through ONCE with a context entry telling the model to `CronList` and `CronDelete` its
     `/multi-manager:tick` job because the panel now runs check-ins, then act on the digest as usual. Later scheduled
     ticks (if the model did not delete it) are dropped as today. Keep 022's drop logic for this case.
   - Fallback stays automatic: when the mod is not loaded, nothing refuses `CronCreate`, so the model's timer works as
     today.
3. **Front desk briefing** (`briefings/front-desk.md`, step 3): say the panel runs check-ins itself when loaded, so
   `CronCreate` of the tick may be refused with that reason: then do not arm a timer and do not retry. Without the
   panel, arm as today. Keep it to two or three sentences. Do not edit `commands/tick.md` (task 025 does).

## Facts already checked (API types in `.claude-plugin/types/claude-code/index.d.ts`)
- `$.command.run`: "Runs a slash command as if the person typed `/command args` ... queued and run once the session is
  idle ... through every hook but the calling one with `e.origin` `{ kind: 'plugin', name }`, its lines in the transcript."
  (around line 3266). Confirm the calling-hook rule does not hide the tick from your own `prompt.submit` hook when the
  call comes from a timer callback.
- `$.prompt.submit` runs once idle; origin `{ kind: 'plugin', name }` (around line 3110 and 9731).
- Drop reasons are always shown (around line 10015).

## Tests first (mod-test)
- Due check-in, quiet digest: no `command.run`, no `prompt.submit`, band shows last check.
- Due check-in, new fingerprint: exactly one `command.run('multi-manager:tick')`; the following tick prompt gets the
  digest context; fingerprint and time recorded.
- Same fingerprint next time: no command. Paused: no command.
- Roster error / timeout / odd answer: check-in runs without a digest.
- `command.run` rejects: fallback prompt submitted.
- No second check-in while one is pending; a pending one that never resolves stops blocking after the limit.
- `CronCreate` with `/multi-manager:tick` in the front desk: refused; another `CronCreate`: passes; in an architect
  session (`MM_ROLE=architect`): passes.
- First scheduled tick after activation: passes with the "delete your timer" context; a later one is dropped.
- Not the front desk yet: no check-ins.

## Files expected to change
`hooks/register.tsx`, `hooks/roster-view.ts`, `types/index.d.ts` (if needed), `mod-test/*`, `briefings/front-desk.md`.
Claim `briefings/front-desk.md` before editing; release on return.

## Out of scope
- `commands/tick.md` and roster server code (task 025). Architect / project manager timers.
- Reloading the plugin, restarting anything live, opening terminal tabs.

## Test scope
`npm run typecheck:mod` (3 errors are pre-existing on main: BAND tests), `npm run test:mod`, `npm run lint`, and,
because `briefings/` changes: `node --test test/briefings.test.ts test/plugin-manifest.test.ts test/hooks-config.test.ts`.
Never the full suite. Commit as you go on your branch.

## Send-back round 1 (2026-11-10)
Outside review: changes are small and clean, no out-of-scope edits, but two paths work against the goal and one test proves nothing.

1. **Fingerprint saved only if the panel's tick reaches our own `prompt.submit` hook** (`hooks/register.tsx:426-433`, `handlePanelTick`). The types say `$.command.run` runs "through every hook but the calling one"; that hand-off is unproven and the tests submit the tick by hand. If the hook is skipped, `lastTick` never advances and every 10 minutes the same act_on / idle news starts another check-in turn in the chat. Fix: in `runCheckIn` (`register.tsx:384-394`), once `command.run` (or the fallback prompt) resolves, save `lastTick` (fingerprint and the asked time) from the stash if the hook has not already done so. Keep the stash so the hook can still attach the digest if it runs later; make sure fingerprint/time are written once, not twice with different times. Test: no `panelTick` follows the command; the same fingerprint at the next due time starts no second command.
2. **Timer refused / told to delete itself without checking the panel loop is alive** (`register.tsx:476-480` CronCreate refusal, `register.tsx:437-440` TIMER_NOTICE). Both check only `isFrontDesk`, which survives a reload; `timer ??=` (`register.tsx:166`) never restarts an interval that ended. Then the model's timer is gone and no check-ins run, silently. Fix: record a heartbeat in the `clock.every` callback (`lastLoopAt`). Refuse CronCreate and send the delete-your-timer note only when the heartbeat is recent (under about 2 × `POLL_MS`). If a scheduled tick arrives while the loop is stale, clear `timer` and call `startTimer($)`, and let that tick be judged as today (022) without the delete note. Tests: stale loop → CronCreate passes and no delete note; stale loop + scheduled tick → loop restarted.
3. **Test "one failure in a check-in does not stop the later ones" proves nothing** (`mod-test/front-desk-pane.test.tsx` ~1171-1184): `promptMode = 'throw'` only affects `prompt.submit`, which the panel path never calls. Make something inside `maybeCheckIn` really throw once (e.g. the `command.run` hook, or the digest call throwing synchronously), then check the next due time still runs a check-in.
4. **Briefing wording** (`briefings/front-desk.md:10`): the model cannot tell whether the pane is loaded. Reword to: try to arm the timer as before; if `CronCreate` is refused saying the panel runs check-ins, arm none and do not retry.

Also try: a `command.run` rejection test by running with no `command.run` hook registered (in case the kit rejects an unknown name). If the kit still cannot reject, leave it as a stated gap.

Update the return report (round 2 section), commit on your branch, raise done again.
