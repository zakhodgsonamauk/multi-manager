# 022 — The front desk's 10-minute check-in stays out of the chat when nothing needs doing

Goal #124. Branch: `worktree-mm-multi-manager-front-desk-items-dev-022-quiet-tick`. Return report: `docs/multi-manager/tasks/022-quiet-front-desk-tick.return.md` on that branch.
Runs after 020 and 021 are merged (both merged on main: 0ceeb62, fe9da6e) (needs 020's `front_desk_digest` tool and sits beside 021's hook in `register.tsx`).

## Goal
Every 10 minutes the front desk's timer fires `/multi-manager:tick`. Each one puts the prompt line, two or more tool
blocks (`team_health` and `status`, several KB) and at least "all quiet" into the front desk chat, pushing real
information up. After this task a check-in with nothing to act on leaves nothing in the chat; one with something to
act on is short.

1. **The pane mod swallows quiet check-ins.** In `hooks/register.tsx`, an `on('prompt.submit', …)` handler (front desk
   only) that recognises the tick: origin `scheduled-trigger` and the `/multi-manager:tick` command. It calls
   `front_desk_digest` (with `since` = the time of the last tick it let through). Then:
   - `quiet`, or `fingerprint` equal to the last let-through tick's → `{ drop }` the prompt. Update the pane's summary
     line / status band to "Last check HH:MM — all quiet" (or "— nothing new"). No transcript line.
   - otherwise → let it through, adding the digest JSON as `additionalContext`, and remember fingerprint and time.
   - roster unreachable, digest tool missing (old roster server), or any error → let the tick through unchanged
     (today's behaviour). Never drop a tick on an error.
   Keep the decision a pure function in `hooks/roster-view.ts` so it is unit-tested.
2. **Spike first (half an hour at most):** confirm from the API types in `.claude-plugin/types/claude-code/index.d.ts`
   that a `{ drop }` on a prompt command from origin `scheduled-trigger` leaves no transcript entry and starts no
   turn. Write what you found in the return report. If the types say a dropped scheduled command still shows, stop and
   report back before building more.
3. **`commands/tick.md`, front desk section.** When a digest is in the context, act from it: do not call `status` or
   `team_health` unless the digest is missing or you need a detail it lacks. Output at most three short lines, impact
   first. When the digest is missing (mod not loaded), call `front_desk_digest` first and fall back to today's steps
   only if that tool is missing. Architect and project-manager sections unchanged.
4. **Front desk briefing** (`briefings/front-desk.md`): one or two sentences saying quiet check-ins are swallowed by
   the pane and pane answers arrive as context notes (task 021). Keep the timer as it is (it is the fallback when the
   pane is not loaded).

## Notes from 020 and 021
- 021 added a `prompt.submit` handler in `register.tsx` that attaches pane notes; it passes slash commands
  (`e.command`) and `isMeta` prompts through untouched. Yours sits beside it as a separate handler. Find out from the
  types whether a scheduled `/multi-manager:tick` arrives with `command` set and/or `isMeta`, and whether `{ drop }`
  is allowed on it (the `command` field doc says a drop stops a prompt command before it is rendered).
- 020's `front_desk_digest` answers: `quiet`, `paused`, `act_on`, `idle_past_limit`, `new_items`, `fingerprint`
  (see `src/roster/tools-health.ts`). `paused` true: drop the tick (it would only say
  "paused — tick skipped"; the pane already shows paused).

## Tests first
- `mod-test`: the decision function — quiet → drop; same fingerprint → drop; new fingerprint → pass with context;
  error / missing tool → pass unchanged; a non-tick scheduled prompt → untouched; a user-typed `/multi-manager:tick`
  (origin `composer`) → untouched (the user asked for it).
- `mod-test`: the handler records the let-through time and fingerprint; the summary line shows the last quiet check.
- `test/briefings.test.ts`: still passes; add a check that the front-desk section of `tick.md` names `front_desk_digest`.

## Files expected to change
`hooks/register.tsx`, `hooks/roster-view.ts`, `types/index.d.ts`, `mod-test/*`, `commands/tick.md`,
`briefings/front-desk.md`, `test/briefings.test.ts`. Claim `commands/tick.md` and `briefings/front-desk.md` before
editing; release on return.

## Out of scope
- Architect and project-manager ticks. The background monitor in the roster server. Roster server code.
- Removing the front desk's timer. Reloading the plugin or restarting anything live. Opening terminal tabs.

## Test scope
`npm run typecheck:mod`, `npm run test:mod`, `node --test test/briefings.test.ts`, `npm run lint`. Never the full suite.

## Evidence required
Test summary lines; the spike finding quoted from the API types with line numbers.
