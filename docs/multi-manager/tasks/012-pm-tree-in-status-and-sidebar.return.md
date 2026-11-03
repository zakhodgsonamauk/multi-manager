# Return: 012 — project manager tree in status, team_health and the sidebar

Branch `worktree-mm-multi-manager-pm-role-dev-012-pm-tree`.

## What changed
- `src/roster/status.ts`: each project has `project_manager` (`{session_id, name, state, model, last_checkin_at}` or `null`). The `pm` workstream is not listed while a project manager runs on it; its goals still appear. Each architect has `managed_by` (project manager's id, or `null`). The 250-character cuts (009) are untouched.
- `src/roster/tools-health.ts`: front desk sees each project manager with its architects nested (`architects`, each with its developer summary), then architects without one. A project manager sees its own architects with developer summary. Architect view unchanged.
- `types/index.d.ts`, `hooks/roster-view.ts`: `PaneProject.projectManager`, `PaneWorkstream.isManaged`. Health from nested architects is found by session id. A status without `project_manager` gives `null` and no "did not load" note.
- `hooks/register.tsx`: one project manager line under the project, then its architects two spaces deeper (developer line deeper too), then the rest as today. No new colours or symbols; the line goes red when stuck or dead like architects. "Hide project" is not offered while a project manager runs.

## Tests (written first, seen failing, now passing)
- `test/status.test.ts`: project manager + two architects + one outside; no-project-manager shape.
- `test/health.test.ts`: front desk nesting, project manager scope, architect view unchanged.
- `mod-test/front-desk-pane.test.tsx`: tree rendering and indentation; old status shape with no note.

## Test commands
- `node --test test/status.test.ts test/health.test.ts test/archive.test.ts test/server.test.ts test/plugin-manifest.test.ts test/pm-role.test.ts` → `ℹ tests 48`, `ℹ pass 48`, `ℹ fail 0`
- `npm run typecheck` → clean (no errors)
- `npm run lint` → clean (no errors)
- `npm run typecheck:mod` → clean (no errors)
- `npm run test:mod` → ` 33 pass`, ` 0 fail`, `Ran 33 tests across 2 files.`

## Screenshot (opened and judged)
`docs/multi-manager/tasks/012-shots/pane-project-manager-tree.png`. Not a real terminal capture: the test kit has no picture output, so I read the pane's own text lines from a mounted pane (project manager, two architects under it, one outside, developers) and drew them in a monospace image. What I see: project line, then `mm-shop-pm (project manager) — busy, model opus`, its two architects indented one step further, each with `[Stop]`, the developers line deeper still, then the unmanaged `main` architect at today's indent with its developers line. Reads clearly. Real colours and buttons are for the click-through.

## Decisions
Logged in `docs/multi-manager/decisions.md` (2026-11-03, Task 012).

## Gaps
- Pane text is judged from a text render, not a live terminal.
- `typecheck:mod` needed the ignored `.claude-plugin/types` folder copied in from the project folder (not committed).
- I once used `git stash push -u` then `pop` in my own copy while checking a baseline; it restored cleanly.
