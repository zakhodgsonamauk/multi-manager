# Return: 009 — pane survives odd roster answers; status answers stay small

Developer #291, branch `worktree-mm-multi-manager-pane-status-dev-009-pane-odd`.

## What changed
- **Pane (Part 1)**: `rosterJson(result, tool)` now throws `the roster's status answer could not be read (it may be too big): Error: result (…` (note cut to 120 chars) on non-JSON text. `buildView` accepts any answer shape: missing/odd parts come out empty and add a note (`Some roster details did not load: waiting items, projects.`). `poll` uses `Promise.allSettled`: one failed call becomes a note, the rest still draw; all four failing shows "Roster unavailable" as before. `PaneView.notes` added (`types/index.d.ts`); the pane draws the notes dim above "Waiting for you". Files: `hooks/roster-view.ts`, `hooks/register.tsx`, `types/index.d.ts`.
- **Status size (Part 2)**: `src/roster/status.ts` cuts goal `text` and item `body` / `answer` to 250 chars ending ` … (full text: get_goal N)` / ` … (full text: list_items)`, with `text_cut` / `body_cut` / `answer_cut: true` only when cut. `tools.ts` and `guard` untouched. `list_items` / `get_goal` untouched (full text, asserted in test).

## Tests (output lines verbatim)
- `node --test test/status.test.ts test/archive.test.ts`: `ℹ tests 10`, `ℹ pass 10`, `ℹ fail 0`.
- Size, 20 goals x 5000 + 20 items x 5000 across two projects: `status size, 20 goals x 5000 chars + 20 items x 5000 chars: 23134` (under 25,000).
- `npm run test:mod`: ` 26 pass`, ` 0 fail`, `Ran 26 tests across 2 files.` New file `mod-test/pane-odd-answers.test.tsx` (7 tests) failed 7/7 before the change (` 19 pass`, ` 7 fail`). Includes the pane built when `status` is the too-big note string (shows open item #12 and the plain message, no "Roster unavailable").
- `npm run typecheck`: clean. `npm run lint`: clean.
- `npm run typecheck:mod`: reports only `TS2307` (cannot find module `claude-code`), `TS7006`, `TS2874` (JSX `h`) errors, in the whole mod-test folder and register.tsx. These appear on the untouched code too: the `claude-code` types exist only in the staged folder `test:mod` builds. No other error kinds.

## Decisions
See `docs/multi-manager/decisions.md` (2026-11-03). Cut is 250, not 300.

## Gaps / for the architect
- At a 300 cut the 20x5000 test measured 25,134 (over the goal), hence 250.
- Items addressed to the front desk appear twice in the status answer (`waiting_for_user` and project `open_items`). Test layout puts items on the architect so they count once. If all 20 items waited for the user, size is ~37,000 at 300. Removing the duplicate changes the answer's shape; not done.
- No screenshots taken (no click-through run; pane tests render the mod in the test kit).
- Claims on the three hooks files and `status.ts` to be released after your review.

## Send-back round 1 (fixes)
1. "Unavailable" now means status, team_health and list_items all failed (resources is not fetched every poll, so it is not counted); the last good view stays. Test: `a total failure on a later poll, with resources cached, says "Roster unavailable" and keeps the last view`.
2. `poll` keeps the previous announced items when list_items failed, and the previous announced trouble when status or team_health failed. Test: `a poll where status fails, then recovers, does not toast the same trouble or items again`.
3. `buildView` makes odd values safe: non-number spend/budget/ids become 0 / null, non-string text/body/names become '', `developers` missing `hung`/`stalled`/`dead` become empty lists, null entries are dropped from every list including `binaries`. Tests: `buildView copes with null list entries and missing numbers and text`, `the pane draws a status with null entries and missing fields without failing`.
4. Notes are keyed by index. The test kit cannot see a Text's key, so the test only checks that two identical notes both draw; the fix is in the code (`hooks/register.tsx`, `note-${index}`).
5. My entry moved from `docs/multi-manager/decisions.md` to `docs/multi-manager/pane-status/decisions.md` (shared file back to its original).

Tests after fixes: `npm run test:mod`: ` 31 pass`, ` 0 fail`, `Ran 31 tests across 2 files.` (5 new tests failed 5/5 before the fixes.) `node --test test/status.test.ts test/archive.test.ts`: `ℹ pass 10`, `ℹ fail 0`. `npm run typecheck` and `npm run lint` clean. `typecheck:mod`: only the known TS2307 / TS7006 / TS2874 environment errors.
