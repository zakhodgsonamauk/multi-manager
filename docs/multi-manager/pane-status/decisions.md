# Decisions — workstream `pane-status`

- 2026-11-03 Status summary cuts goal texts and item bodies/answers to 300 characters with a pointer to `get_goal` / `list_items`. Context: the front desk could not read its own `start_front_desk` answer in one go; the pane cuts goal text to 100 characters anyway. Alternatives: drop pretty-printing (saves only ~10%, and lives in `src/roster/tools.ts`, claimed by goal #83); paginate status (bigger change, more calls).
- 2026-11-03 Pane fetches its four roster calls independently (allSettled) so one bad answer shows a plain note instead of blanking the pane. Alternative: keep all-or-nothing with a better message; rejected because the goal asks to "show the parts it has".
- 2026-11-03 One task (009), not two: both halves are small and share the test story; it avoids `src/roster/tools.ts` entirely to stay clear of goal #83.
