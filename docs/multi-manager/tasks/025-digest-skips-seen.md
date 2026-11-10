# 025 — The check-in digest stops re-sending items the user has already seen

Goal #129. Branch: `worktree-mm-multi-manager-front-desk-items-dev-025-digest-seen`. Return report: `docs/multi-manager/tasks/025-digest-skips-seen.return.md` on that branch.

## Why
The front desk's check-in re-sent item #1053, which the user had already seen. `front_desk_digest`
(`src/roster/tools-health.ts`, the `new_items` query around line 143) lists every open item addressed to the front
desk raised after `since`; it ignores the item's `seen` flag. When `since` is missing (the model calls the digest
itself, or the panel's first check after a reload), every open item comes back as "new". Also, nothing tells the front
desk to mark items seen after showing them, so the flag is set only when the model thinks to.

## What to build
1. `front_desk_digest`: `new_items` leaves out items with `seen = 1` (`AND i.seen = 0`). Update the tool description
   to say so. `quiet` and the fingerprint follow from the shorter list, as now.
2. `commands/tick.md`, front desk section, `new_items` bullet: after showing the new items to the user, call
   `mark_seen` with their ids (`item_ids`). Keep the rest of the file unchanged.

## Tests first
- `test/front-desk-digest.test.ts`: an open item marked seen is not in `new_items` (with and without `since`); `quiet`
  is true when the only open item is seen; an answered/re-routed item that becomes unseen again shows.
- `test/briefings.test.ts` (or plugin-manifest): `commands/tick.md` front desk section names `mark_seen`.

## Files expected to change
`src/roster/tools-health.ts`, `test/front-desk-digest.test.ts`, `commands/tick.md`, maybe `test/briefings.test.ts`.
Claim `commands/tick.md` before editing; release on return.

## Out of scope
Pane mod (`hooks/`), `briefings/front-desk.md` (task 024). Restarting the roster server.

## Test scope
`node --test test/front-desk-digest.test.ts test/briefings.test.ts test/plugin-manifest.test.ts test/hooks-config.test.ts`,
`npm run typecheck`, `npm run lint`. Never the full suite. Commit as you go on your branch.
