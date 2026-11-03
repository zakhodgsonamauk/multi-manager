# 009 — Front-desk pane survives odd roster answers; status answers stay small

Goal #85 (workstream `pane-status`, branch `main`). Developer branch: `worktree-mm-multi-manager-pane-status-dev-009-pane-odd` (dev #291). Return report: `docs/multi-manager/tasks/009-pane-survives-odd-answers.return.md` on your branch.

## Goal
The user's report (verbatim): "\"roster unavailable: undefined is not an object (evaluating 'input.status.winting_for_user.map')\" is in the front-desk sidebar currently"

## What we know (architect's findings)
- `rosterJson` (`hooks/roster-view.ts:60`) returns the raw text when an answer is not JSON. `poll` (`hooks/register.tsx:87`) casts that to `RosterStatus` and `buildView` (`hooks/roster-view.ts:121`) reads `input.status.waiting_for_user.map`, which crashes on a string. Real roster errors arrive with `isError` and are already shown as a plain message, so the crash means the `status` call returned readable-but-not-JSON text (or JSON of a different shape).
- Likely source (not proven): the answer was too big. This morning `status` / `start_front_desk` answers were 75-88 thousand characters; Claude Code swaps a too-big tool answer for a note like `Error: result (N characters ...) exceeds maximum allowed tokens. Output has been saved to ...`. On a copy of the live roster database today the `status` answer is 41,331 characters pretty-printed (37,332 compact): almost all of it is full goal texts (financial-portal: 10 goals, 18 KB; multi-manager: 5 goals, 11 KB).
- `guard` in `src/roster/tools.ts` pretty-prints every answer (`JSON.stringify(value, null, 2)`).

## Part 1 — the pane never dies on an odd answer (hooks/)
Tests first, in `mod-test/front-desk-pane.test.tsx` (or a new focused test file beside it), each failing before the change:
- `rosterJson` on text that is not JSON (use the Claude Code note above as the input) throws an Error whose message is plain and short, e.g. `the roster's status answer could not be read (it may be too big): Error: result (...` cut to about 120 characters. Give `rosterJson` the tool name for the message. Tools whose answers are plain text on purpose (check every `roster(...)` call in `hooks/register.tsx`) must keep working.
- `buildView` with a `status` that lacks `waiting_for_user`, or lacks `projects`, or whose project lacks `workstreams` / `active_goals` / `open_items`, still returns a view: the missing parts are empty, and the view carries a short plain note naming what was missing (for example `Some roster details did not load: waiting items.`), which the pane shows in place of the missing part. Same for `team_health` without `sessions`, `list_items` that is not an array, `resources` that is not an array.
- One failing call does not blank the pane: when `status` fails but `team_health`, `list_items` and `resources` answer, the pane still shows the open items and developer health it has, plus the plain message for status. (Use `Promise.allSettled` in `poll`, or equivalent.) If every call fails, behave as today: the "roster unavailable" line with the first error.
- Keep the existing pane tests green.

## Part 2 — status answers stay small (src/roster/status.ts only)
Tests first, in `test/status.test.ts` (create if missing; see `test/helpers.ts` for an in-memory roster):
- In the status summary, each goal's `text` and each item's `body` and `answer` are cut to at most 300 characters, ending with ` … (full text: get_goal N)` for goals and ` … (full text: list_items)` for items, and gain `text_cut: true` / `body_cut: true` / `answer_cut: true` only when cut. Short texts are untouched and carry no flag.
- With 20 goals of 5,000 characters each and 20 open items of 5,000 characters each across two projects, `JSON.stringify(statusSummary(db), null, 2).length` stays under 25,000.
- `list_items` and `get_goal` still return full texts (they do not go through the summary).

Do the cut inside `statusSummary` / `projectStatus` so both `status` and `start_front_desk` get it. **Do not edit `src/roster/tools.ts`** (claimed by goal #83's developer). Do not change `guard`'s pretty-printing. Update the comments on `GoalStatus` / `ItemStatus` to say the texts are cut and where the full text lives.

## Files expected to change
`hooks/roster-view.ts`, `hooks/register.tsx`, `mod-test/front-desk-pane.test.tsx` (or a new mod test), `types/` if the pane view type gains the note, `src/roster/status.ts`, `test/status.test.ts`. `claim` `src/roster/status.ts` and the hooks files before editing; release after your return.

## Out of scope
`src/roster/tools.ts`, briefings, the model rule (goal #83). Restarting or reloading the roster server, the plugin, the pane or any Windows Terminal tab. Pushing (the architect pushes after merge).

## Test scope
`node --test test/status.test.ts` plus any existing test that uses `statusSummary` (`grep -ln statusSummary test/`), `npm run typecheck`, `npm run lint`, `npm run typecheck:mod`, `npm run test:mod`. No full suite.

## Evidence required
Pass/fail summary lines of each focused run. The size printed for the 20 x 5,000 test. A pane test showing the view built when `status` is the too-big note string.

## Send-back round 1 (2026-11-03)
Part 2 (status cut at 250) is accepted as is, and so is the double listing of front-desk items (logged in pane-status/decisions.md). Fix Part 1:

1. `hooks/register.tsx:93`: "every call failed" counts the `resources` slot even when it was not fetched (`Promise.resolve(undefined)`), so on a poll with cached resources a dead roster gives 3 of 4 failed. The pane then swaps the last good view for an empty one with repeated notes and wipes the announced lists. Fix: count only the calls actually made (or: status, team_health and list_items all failing = unavailable). Test: a total failure on a later poll, with resources cached, shows "Roster unavailable" and keeps the previous view.
2. `hooks/register.tsx:103`: when `status` or `list_items` fails, `dueToasts` sees empty lists and resets the announced sets, so every item or trouble toasts again on recovery. Fix: when a part failed, keep that part's previous announced set. Test: status fails for one poll, then recovers; no repeat toasts.
3. `hooks/roster-view.ts:160` and `:178`: `spend_today_usd`, `spent_usd`, `budget_usd`, goal `text` pass through unchecked; drawing then calls `money(undefined)` / `oneLine(undefined)` (`register.tsx:384`, `:475`) and throws. Fix in `buildView`: non-numbers become 0 (spend) or null (budget), non-strings become ''. Same for item `body` before `dueToasts`, a `developers` object missing `hung`/`stalled`/`dead` (`:173`), and null entries in lists (e.g. `binaries` at `:200`, null items in `waiting_for_user`/`open_items`/`sessions`). Test: one view built from a status with null list entries and projects/goals missing their number and text fields renders without throwing.
4. Duplicate notes must not share a key: dedupe the notes or key by index.
5. Move your entry from `docs/multi-manager/decisions.md` (shared project file) to `docs/multi-manager/pane-status/decisions.md`.

Same test scope. Update the return report, raise done again.
