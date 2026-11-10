# 025 — return report (round 1)

Branch: `worktree-mm-multi-manager-front-desk-items-dev-025-digest-seen`. Last commit: `35a25c8` (code and tests). This report is committed next.

## What changed
- The front desk's check-in digest re-sent items the user had already seen (#1053, #1054). Cause: the `new_items` query ignored the seen flag.
- `front_desk_digest` now leaves out items marked seen, with or without `since`. Items handed back unseen show again. `quiet` follows from that. Tool description updated.
- `commands/tick.md`, front desk `new_items` bullet: after showing the items, call `mark_seen` with their ids. Nothing else in the file changed.
- Tests written first. Three new digest tests failed before the fix (seen item still listed), then passed after it.

## Tests run
- `node --test test/front-desk-digest.test.ts test/briefings.test.ts test/plugin-manifest.test.ts test/hooks-config.test.ts`
  - `ℹ tests 29` / `ℹ pass 29` / `ℹ fail 0`
- `npm run typecheck`: `tsc --noEmit -p tsconfig.json`, exit 0, no errors.
- `npm run lint`: `eslint .`, exit 0, no output.
- Before the fix (first run): the seen-item test failed with the item still listed in `new_items`.
- Fixed a broken regex line in my own new test and added `item_ids` to the existing "not a roster tool" allowlist, so the snake_case check passes.

## Screenshots (opened and judged)
None. Nothing visual changed.

## Decisions made
- Seen-items rule lives in the digest query, not in the tick. The digest does not mark items itself; the front desk calls `mark_seen` after showing them (task asked for this).
- `item_ids` allowlisted in the snake_case test, same as `session_id`.
- Logged in `docs/multi-manager/decisions.md` (Task 025 entry).

## Gaps
- Not run: the full test suite (out of scope per task).
- Roster server not restarted; the digest change goes live when the server next restarts. Front desk to decide the restart.
- Not checked against a live front desk pane. The fix is covered by tests only.
