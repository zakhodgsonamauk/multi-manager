# 019 — return report

Branch: `worktree-mm-multi-manager-graph-watcher-dev-019-code-graph-pm-briefing`.

## What changed
The project manager now knows it owns its project's code-review-graph switch, and when to use it.
- `briefings/project-manager.md`: new "Code search tool" section (4 lines of text).
- `briefings/front-desk.md`: one line saying the front desk may also switch it.
- `commands/pm-intake.md`: when a project gets its first workstream, decide the switch, default off.
- `test/briefings.test.ts`: checks for the three project-manager points, the front-desk line, and the pm-intake step.
- `docs/multi-manager/decisions.md`: dated entry for Task 019.

No code changes. No other briefings touched.

## New briefing text (quoted)
Project manager, "Code search tool" section:
> ## Code search tool
> Code-review-graph lets the teams search the project's code by meaning. You own its switch: `set_code_graph` turns it on or off. It is off unless the project's teams will search a large codebase. Each open tab in an "on" project costs about 0.57 GB of memory. The background index updater and stale-data cleanup run by themselves. You decide and log the decision in `decisions.md`.

Front desk:
> - Code search tool (code-review-graph): the front desk may also switch it with `set_code_graph`; the project manager owns it (see its briefing).

pm-intake, step 1:
> 1. Work out which workstream it belongs to (`list_workstreams`). If none fits, `add_workstream`. If this is the project's first workstream, decide its code search switch: `set_code_graph` stays off (default off) unless the teams will search a large codebase. Log the decision in `decisions.md`.

Size: project manager briefing 4609 characters (limit 7500; architect briefing 7256 still longer). Front desk briefing 7042 characters (limit 7500).

## Tests run
`node --test test/briefings.test.ts`
```
ℹ tests 10
ℹ pass 10
ℹ fail 0
```
Before the briefing edits, the new checks failed as expected (the pm-intake check showed the old command text missing "first workstream").

`npx eslint .` — no output, exit 0.

Full suite not run, per task scope.

## Screenshots
None; no UI.

## Decisions made
Logged in `docs/multi-manager/decisions.md` (2026-11-03, Task 019). The 0.57 GB figure is copied from the task file, not re-measured.

## Gaps
- The 0.57 GB figure is not checked here; it comes from the task brief.
- Briefing text is read by the sessions at start-up; not verified in a live project manager session.
