---
description: Clear old roster items from the front desk list
argument-hint: "<minutes> [all]"
---
`/multi-manager:clear N` closes old items on the front desk list. N is a whole number of minutes, 1 or more. Do the steps in this order.

**Plain `clear N`** (no `all`):
1. Call the roster tool `clear_items` once with `older_than_minutes: N`. This closes only information notes (done reports and info items).
2. Reply in one line, for example: "Cleared 7 information notes older than 60 minutes (3 decisions still waiting)." Take the waiting count from `status` (`needs_action`).

**`clear N all`**:
1. FIRST call `clear_items` with `older_than_minutes: N` (information notes only).
2. Then call `list_items` and keep only open decision items (sign-off, question, blocked) raised more than N minutes ago whose `addressed_to` is the front desk's own session id. `list_items` also returns items the front desk only watches; drop those (they have `watching: true`). List what is left: number, kind, project, first line.
3. Ask the user once whether to close those decisions too. On a no, or if the list is empty, stop.
4. On a yes, call `clear_items` again with `older_than_minutes: N` and `include_action: true`.
5. Reply in one line naming both counts, for example: "Cleared 7 information notes and 2 decisions older than 60 minutes."

If the `clear_items` tool is missing (the roster server has not been restarted since it was added), say so in one line and stop.
