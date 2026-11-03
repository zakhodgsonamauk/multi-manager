# Task 014 return: start_front_desk answer stays small

Status: done except ONE acceptance test that fails on size (see "Open problem").

## Files changed
- `src/roster/tools.ts`: new exported `frontDeskStartText(db, pluginRoot, desk)`; `start_front_desk` calls it; status part is `JSON.stringify(statusSummary(db))` (compact). The `status` tool returns the compact string (so `guard` does not indent); description now says items waiting for the user are listed once, under waiting_for_user.
- `src/roster/status.ts`: a project's `open_items` leaves out items that are open and addressed to the front desk (they are in `waiting_for_user`). Also (my addition): `answer` is left out of an item when null (was `"answer":null`), type `answer?: string`; the sidebar does not read `answer`.
- `test/status.test.ts`: first test now expects the waiting signoff only under waiting_for_user (`open_items` empty); comment in the big-status test updated; the cut test reads its front-desk-addressed items from `waiting_for_user`.
- `test/front-desk-start.test.ts` (new): size test, compact/parse test, listed-once test.
- `commands/status.md`: not changed (wording still right).

## Test output
- `node --test test/status.test.ts`: 7 pass, 0 fail.
- `npm run typecheck`, `npm run lint`: clean.
- `npm run test:mod`: 33 pass, 0 fail (sidebar still parses the answer).
- `node --test test/front-desk-start.test.ts`: 2 pass, 1 FAIL (size).
  - `start_front_desk text size, 3 projects, 20 goals + 20 items + 5 waiting x 5000 chars: 26478`
  - `status JSON size (compact): 19857`
  - The briefing (`briefings/front-desk.md`) is 6,542 chars of the 26,478.

## Open problem
The spec'd data (45 items + 20 goals, all cut to 250 chars) gives a compact status of 19,857 chars; with the 6.5K briefing the whole text is 26,478, over the 25,000 limit. Each cut item still carries about 220 chars of fields (kind, state, goal_id, raised_by, raised_by_running, addressed_to, seen, created_at) and each goal about 100. Before my `answer` change it was 26,828. Indented it would be far larger. The remaining ~1,500 chars would have to come from a decision outside this task: drop more item fields (e.g. `created_at`, `seen`, `addressed_to` from project `open_items`, which the pane does not read; `created_at` and `raised_by_running` ARE read for waiting items), shorten the 250 cut, or shrink the briefing. I left the 25,000 assertion as the task wrote it, so the test fails until that is decided. Real data measured 12,976 compact status + 6,600 briefing earlier, which is well under.

## Round 1
- `src/roster/status.ts`: `cutText` and `itemRows` take a max length; new exported `PROJECT_ITEM_TEXT_MAX = 120` beside `STATUS_TEXT_MAX = 250`. Project `open_items` body/answer cut at 120; `waiting_for_user` and goal texts stay at 250. Interface comment updated.
- `test/front-desk-start.test.ts`: added assertions that project item bodies are at most 120 (and flagged cut) and waiting item bodies at most 250 (and longer than 120). The 25,000 assertion is unchanged.
- Results: status test + new test 10 pass, 0 fail; typecheck and lint clean; test:mod passes.
- Sizes: `start_front_desk text size ... : 23878` (was 26478); `status JSON size (compact): 17257` (was 19857); the older indented-size log in status.test.ts: 20140.
