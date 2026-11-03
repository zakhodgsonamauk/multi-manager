# 012 — Status, team health and the sidebar show the tree: front desk → project manager → architects → developers

Goal #89 (workstream `pm-role`, branch `main`). Waits for task 011 **and** for goal #85's task 009 to merge (it edits `src/roster/status.ts`, `hooks/roster-view.ts`, `hooks/register.tsx`): pull in the latest `main` before you start. Developer branch: filled in at dispatch. Return report: `docs/multi-manager/tasks/012-pm-tree-in-status-and-sidebar.return.md` on your branch.

## Goal
Today the project manager shows up as "the architect of the `pm` workstream", and `team_health` for a project manager shows only developers (it has none). After this task, whoever looks (the user in the sidebar, the front desk in `status` / `team_health`, the project manager in `team_health`) sees who manages whom.

## What we know
- `status` (`src/roster/status.ts:99-147`) groups by project, then workstream, with one `runningArchitect` per workstream. The sidebar (`hooks/roster-view.ts:125-146, 176-208`) follows it: project, workstream, architect plus a developers line.
- `team_health` (`src/roster/tools-health.ts:66-84`) groups by caller role: an architect sees its developers; the front desk sees every architect with a developer summary.
- `list_sessions` (`sessionTree`, `src/roster/sessions.ts:147`) is already a real tree by `parent_id`.
- Task 009 (goal #85) is merged (1612de5): the status summary cuts goal texts and item bodies/answers at 250 characters with `text_cut` / `body_cut` / `answer_cut` flags, and `PaneView` gained `notes: string[]` for parts that did not load. Keep both behaviours; extend the notes handling to the new field.

## Decisions already made (do not reopen)
- `status`: each project gains `project_manager` (`null` when none runs): `{ session_id, name, state, model, last_checkin_at }`. The `pm` workstream is not listed as an ordinary workstream when a project manager runs on it (its goals still appear under the project manager). Each workstream's architect gains `managed_by` (the project manager's session id, or `null` when its parent is the front desk).
- `team_health`: the front desk sees project managers, each with its architects nested (and their developer summary, as today), then architects with no project manager, as today. A project manager caller sees its own architects with their developer summary (the view the front desk has today, scoped to its tree). An architect caller: unchanged.
- Sidebar: under a project with a project manager, one line for the project manager (name, state, model), then its architects indented one step further than today; architects not under it keep today's layout. No new colours or symbols beyond what the pane already uses; follow the existing style.

## Tests first
Write these first and see each fail:
1. `test/status.test.ts`: a project with a running project manager on `pm` and two architects under it, plus one architect under the front desk: `project_manager` set, `pm` not in `workstreams`, `managed_by` set on the two and `null` on the third. A project with no project manager: output identical to today's (snapshot the shape).
2. `test/health.test.ts` (or `tools-monitor` tests, whichever covers `team_health`): front desk view nests architects under their project manager; project manager view lists its architects and their developers' health; architect view unchanged.
3. `mod-test/front-desk-pane.test.tsx`: `buildView` with the status above renders the project manager line and its architects one level deeper; a status from before this change (no `project_manager` field) still renders as today, with no "missing" note for that field.

## Files expected to change
`src/roster/status.ts`, `src/roster/tools-health.ts`, `hooks/roster-view.ts`, `hooks/register.tsx` if needed, `types/` if the pane's view type changes, the tests above. `claim` each before editing; release after your return.

## Out of scope
Launch and lifecycle (010), item routing and rules (011), briefings and README (013). Restarting or reloading the roster server, the plugin, the pane or any terminal tab. Pushing.

## Test scope
`node --test test/status.test.ts test/health.test.ts` (plus any test using `statusSummary` or `team_health`: `grep -ln "statusSummary\|team_health" test/`), `npm run typecheck`, `npm run lint`, `npm run typecheck:mod`, `npm run test:mod`. No full suite.

## Evidence required
Pass/fail summary line of each run. A screenshot of the pane rendered from test data with one project manager, two architects under it, one architect outside it, and developers (render the view the way the mod tests do, capture it to a PNG under `docs/multi-manager/tasks/012-shots/`, open it and say what you see). The architect judges layout and readability from that image.
