# 020 — Item categories, auto-clear and a small "anything to do?" answer (roster server)

Goal #124. Branch: `worktree-mm-multi-manager-front-desk-items-dev-020-item-categories`. Return report: `docs/multi-manager/tasks/020-item-categories-autoclear.return.md` on that branch.

## Goal
The front desk's list of roster items mixes "you must decide this" with "for your information", and nothing ever clears
itself, so the list grows until someone closes items by hand. This task gives every item a category, clears
information-only items automatically, splits the front desk's status answer by category, and adds one small roster
tool that says in a line or two whether the front desk has anything to act on (task 022 uses it to keep the
10-minute check-in quiet).

1. **Category** (derived from `kind`, no database change): `action` = signoff, question, blocked; `info` = done, info.
   Export one helper (e.g. `itemCategory(kind)`) from `src/roster/items.ts` and use it everywhere below.
   `list_items` rows gain a `category` field.
2. **Auto-clear** (on by default, no switch). The background monitor pass (`runTick`, `src/monitor/monitor.ts`, front
   desk's roster server only, under the existing lease) closes an item when ALL of:
   - its category is `info` and its state is `open`; and
   - either it was raised 24 hours or more ago, or its goal is `done` or `cancelled` and it was raised 1 hour or more ago.
   Action items are never closed automatically. Answered items are not touched. Record the count in the tick result
   (e.g. `autoClosed`). One UPDATE, idempotent, no new columns.
3. **Status split.** `statusSummary` (`src/roster/status.ts`): replace the single `waiting_for_user` list with
   `needs_action` (open action items addressed to the front desk, oldest first) and `for_information` (open info items
   addressed to the front desk, newest first, text cut to 120 characters). Keep a `waiting_for_user` key holding only
   `needs_action` so older readers (the pane on an old reload, briefings) keep working. Check the size test for
   start_front_desk still passes (target under 25,000 characters).
4. **New tool `front_desk_digest`** (front desk only; others get a clear error). Returns compact JSON:
   - `quiet`: true when nothing below is non-empty.
   - `paused`: as `team_health` reports it.
   - `act_on`: sessions whose `recommended_action` is not `none` (id, name, role, state, action, reason), from the
     same logic `team_health` uses (reuse it, do not copy it).
   - `idle_past_limit`: architects idle longer than their project's `idle_stop_minutes` with no goal in
     new/planning/awaiting-signoff/in-progress (id, name, idle minutes).
   - `new_items`: open items addressed to the front desk raised since the `since` argument (optional ISO time),
     each id, kind, category, project, raiser name, body cut to 200 characters.
   - `fingerprint`: a short stable string built from the ids and actions above, so a caller can tell "same as last time".
   A quiet answer must be under 200 characters.

5. **User clear command** (user's sign-off answer on item #1035, verbatim: "looks good, 24h is fine but we need a user
   command of say "clear 60" which clears anything older than 60 minutes. fine on testing.")
   - New roster tool `clear_items` (front desk only): `older_than_minutes` (integer, 1 or more), optional
     `include_action` (default false). Closes open items addressed to the front desk raised more than that many
     minutes ago: information items always; action items only when `include_action` is true. Returns the count and
     the ids closed, split by category. Answered items are untouched.
   - New command `commands/clear.md` (`/multi-manager:clear 60`, argument-hint "<minutes> [all]"): the front desk
     calls `clear_items` with the minutes; with `all` it first lists the action items that would close (number, kind,
     project, first line) and asks the user once before passing `include_action: true`. Reply in one line, e.g.
     "Cleared 7 information notes older than 60 minutes (3 decisions still waiting)." If the tool is missing (roster
     server not yet restarted), say so in one line and stop.

## Tests first
- `test/items.test.ts`: `itemCategory` maps all five kinds; `list_items` rows carry `category`.
- `test/monitor.test.ts` (or a new `test/items-autoclear.test.ts`): info item 25 h old closed; info item 2 h old kept;
  info item 2 h old on a done goal closed; info item 30 min old on a done goal kept; action item 30 days old kept;
  answered item kept; second pass closes nothing more.
- `test/status.test.ts`: `needs_action` and `for_information` split and ordering; `waiting_for_user` equals
  `needs_action`.
- New `test/front-desk-digest.test.ts`: quiet answer and its length; a stuck architect appears in `act_on`; an idle
  architect with no live goal appears in `idle_past_limit`, one with a live goal does not; `since` filters
  `new_items`; fingerprint stable across calls and changes when an item is added; non-front-desk caller refused.
- New `test/clear-items.test.ts`: `clear_items` 60 closes info items 61 min old, keeps 59 min old, keeps action items
  unless `include_action`; never touches answered items or items addressed to other sessions; refuses minutes < 1
  and non-front-desk callers.
- `test/briefings.test.ts` or `test/plugin-manifest.test.ts`: `commands/clear.md` exists with a description and names
  `clear_items`.

## Files expected to change
`src/roster/items.ts`, `src/roster/status.ts`, `src/monitor/monitor.ts`, `src/roster/tools.ts` or
`src/roster/tools-health.ts` (where `team_health` lives), `commands/clear.md`, the tests above. Claim `src/roster/tools.ts`,
`src/roster/status.ts` and `src/monitor/monitor.ts` with the roster `claim` tool before editing; release on return.

## Out of scope
- The pane (`hooks/`), `commands/tick.md`, briefings: tasks 021 and 022.
- Any database schema change or new column. Any change to `answer_item` / `close_item` behaviour.
- Restarting or reloading anything. Do not touch the live roster database (`~/.claude/multi-manager/roster.db`);
  tests use their own temporary database (see `test/helpers.ts`).

## Test scope
`node --test test/items.test.ts test/status.test.ts test/monitor.test.ts test/front-desk-digest.test.ts
test/front-desk-start.test.ts test/server.test.ts test/clear-items.test.ts test/plugin-manifest.test.ts` (plus any new test file), then `npm run typecheck` and
`npm run lint`. Never the full suite. One test run at a time.

## Evidence required
The test summary lines; the measured length of a quiet `front_desk_digest` answer and of `start_front_desk` in the
size test.
