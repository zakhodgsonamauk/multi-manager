# 020 — return report (round 1)

Branch: `worktree-mm-multi-manager-front-desk-items-dev-020-item-categories`.

## What changed
- Every item has a category: action (signoff, question, blocked) or info (done, info). `itemCategory` in `src/roster/items.ts`; `list_items` rows carry `category`.
- The background monitor pass closes information items that are 24 h old, or 1 h old on a done or cancelled goal. Action and answered items are never closed. Count is `autoClosed` on the tick result. One UPDATE.
- Status answer now has `needs_action` (oldest first) and `for_information` (newest first, 120 chars). `waiting_for_user` equals `needs_action`.
- New tool `front_desk_digest` (front desk only), new tool `clear_items` (front desk only), new command `commands/clear.md`.

## Tests run
- `node --test test/items.test.ts test/status.test.ts test/monitor.test.ts test/front-desk-digest.test.ts test/front-desk-start.test.ts test/server.test.ts test/clear-items.test.ts test/plugin-manifest.test.ts test/items-autoclear.test.ts`
  - `ℹ tests 50` / `ℹ pass 50` / `ℹ fail 0`
- `npm run typecheck`: no errors. `npm run lint`: no errors.

## Measured
- Quiet `front_desk_digest` answer: `quiet front_desk_digest length: 102` characters (limit 200).
- `start_front_desk text size, 3 projects, 20 goals + 20 items + 5 waiting x 5000 chars: 24395` (limit 25,000).

## Screenshots (opened and judged)
None. Roster server only, no screen change.

## Decisions made
Logged in `docs/multi-manager/decisions.md` (2026-11-10, Task 020). Main one: the start_front_desk text drops the `waiting_for_user` copy, because with it the text was 26,716 characters. `status` tool and `statusSummary` keep it.

## Gaps
- Not run against the live roster (told not to restart). The new tools appear only after the roster server restarts; `commands/clear.md` says so if the tool is missing.
- `hooks/roster-view.ts` still reads `waiting_for_user` (now decisions only; notes no longer show in the pane until task 021).
- `front-desk` briefing text still says "every open item"; left for 021/022.
- Existing status tests changed: two used info/done items as "waiting" items, switched to question/blocked.

# Round 2 (send-back round 1)

1. `commands/clear.md` rewritten with the order spelled out: plain `clear N` is one `clear_items` call and a one-line reply; `clear N all` does the information-only call first, then lists only decisions addressed to the front desk (drops watched items), asks once, then calls again with `include_action: true`, and replies with both counts.
2. `src/monitor/monitor.ts`: auto-clear now has its own try/catch, separate from the death and enforcement block; errors go into the tick result's `errors`.
3. `src/roster/items.ts` `clearItems`: the select and the updates run inside `tx`, so the reported count matches what closed.
4. `test/items-autoclear.test.ts`: added a 2 h old info item on a cancelled goal (closed) and an info item addressed to an architect, 25 h old (closed, pins the rule). Closed count now 4.

Tests: same nine files as round 1: `ℹ tests 50`, `ℹ pass 50`, `ℹ fail 0`. `npm run typecheck` and `npm run lint`: no errors.
