# Task 014: start_front_desk answer stays small

Goal: roster goal #97 (workstream pane-status). Follow-up to task 009 (commit 1612de5).

## Background (checked 2026-11-03)
- The front desk measured its `start_front_desk` answer at 54,111 characters; Claude Code saved it to a file ("Output too large (54.9KB)"), so the front desk cannot read its briefing in one go.
- Real cause of that 54K: the front desk's roster server process started at 09:27, before 1612de5 merged, so it runs the old status code without the 250-character cut. Not a code bug; it goes away when that server restarts.
- Still wanted, on current code: `start_front_desk` (`src/roster/tools.ts:113-134`) prints the status part with `JSON.stringify(..., null, 2)` (indented). The `status` tool goes through `guard`, also indented. On a copy of today's roster: status 18,039 chars indented, 12,976 compact; briefing 6,600.
- Items addressed to the front desk and open appear twice: in `waiting_for_user` and again in their project's `open_items` (`src/roster/status.ts:180` and `:192`; comment in `test/status.test.ts:113-114`).

## Do
1. Move the `start_front_desk` answer text into an exported function (for example `frontDeskStartText(db, pluginRoot, desk)` in `src/roster/tools.ts` or a small new module) so a test can build it without the tool connection. The tool calls it.
2. Print the status part compactly: `JSON.stringify(statusSummary(db))`, no indentation.
3. The `status` tool also answers compact JSON (return the string, so `guard` does not indent it). The sidebar (`hooks/roster-view.ts`) parses it with JSON.parse; check it still works (mod tests).
4. Waiting items listed once: a project's `open_items` leaves out items that are in `waiting_for_user` (open and addressed to the front desk). Update the `status` tool description to say so ("items waiting for the user are listed once, under waiting_for_user"). Update `commands/status.md` only if its wording becomes wrong.
5. Tests (focused, in `test/`):
   - The whole `start_front_desk` text (real `briefings/front-desk.md`, header lines, status) with realistic large data stays under 25,000 characters: 3 projects, 20 active goals of 5,000 chars, 20 open architect items of 5,000 chars, 5 waiting front desk items of 5,000 chars. Log the measured size.
   - The status part of that text is compact (no newline inside the JSON) and parses.
   - An open item addressed to the front desk appears in `waiting_for_user` and in no project's `open_items`; an item addressed to an architect still appears under its project. Update the existing test at `test/status.test.ts:39` and the comment at `:113-114` to match.
   - Existing status tests still pass.

## Out of scope
- Restarting, reloading or calling any live roster server. Do not call `start_front_desk` on the live roster.
- Changing the 250-character cut, `list_items`, `get_goal`, briefings text, the pane's drawing.

## Acceptance
- `npm run typecheck`, `npm run lint` clean; `node --test test/status.test.ts` and the new test pass; `npm run test:mod` passes (sidebar still parses the answer).
- Return report `docs/multi-manager/tasks/014-front-desk-start-small.return.md` on the branch: files changed, test output lines with the measured sizes.
