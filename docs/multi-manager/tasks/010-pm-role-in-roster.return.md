# 010 — Return report: the roster knows the project manager role

Developer #293, branch `worktree-mm-multi-manager-pm-role-dev-010-pm-role`.

## What changed
- `src/roster/db.ts`: sessions role CHECK now allows `project-manager`; new partial unique index `one_running_project_manager_per_project`. `migrate()` rebuilds the sessions table (transaction, foreign keys off during the swap, foreign-key check after) only when the old CHECK is present; a second run does nothing.
- `src/roster/sessions.ts`, `models.ts`: role added; `runningProjectManager()`; project managers launch on opus (explicit, then recorded, then opus) like architects.
- `src/launch/launcher.ts`, `command.ts`: `launchProjectManager` (creates `pm` workstream if missing, one per project, returns the running one, parent = caller), `stopProjectManager`, restart and model change accept the role, project-manager start and restart prompts.
- `src/roster/tools.ts`: new tools `launch_project_manager`, `stop_project_manager` (front desk only); `get_briefing` / `register_session` accept the role (enum comes from `ROLES`); `log_model_use` allows a project manager.
- `tools-recovery.ts`: `restart_architect` takes a project manager; `restorable_sessions` nests architects under it; `restore_all` restores manager, then its architects.
- `tools-pause.ts`: `finish_pause` stops project manager, architect, developer; `resume` relaunches managers first and parents each project's architects to the new manager (front desk if the project had none).
- `src/monitor/health.ts`, `monitor.ts`: one addressee rule; stuck detection covers the role. `tools-health.ts`, `tools-monitor.ts`, `projects.ts`: role checks only.
- `briefings/project-manager.md`: short placeholder.
- Tests: `test/db.test.ts` (2 new), `test/pm-role.test.ts` (12 new, covers items 2-9), `test/briefings.test.ts` (project-manager entry), `test/server.test.ts` (tool list).

## Tests (verbatim)
`node --test test/db.test.ts test/launcher.test.ts test/launch-model.test.ts test/recovery.test.ts test/pause.test.ts test/health.test.ts test/monitor.test.ts test/briefings.test.ts test/sessions.test.ts test/pm-role.test.ts test/server.test.ts test/models.test.ts test/command.test.ts test/tools-monitor.test.ts test/projects.test.ts test/change-model.test.ts`
```
ℹ tests 137
ℹ pass 137
ℹ fail 0
```
`npm run typecheck`: no errors. `npm run lint`: no errors. No full suite run.

Tests were written first; before the code they could not compile or run (missing exports), so "see each fail" was by absence of the feature, not by running red.

## Captured launch command (project manager)
`CAPTURED PM LAUNCH: --model opus; briefing I:\mm\briefings\project-manager.md; MM_ROLE=project-manager` (also `MM_PARENT_ID` = front desk id, asserted).

## Migration on a copy of the live roster
Copy of `~/.claude/multi-manager/roster.db` (live file only read). Role CHECK before: old (no project-manager).
```
before {"claims":3,"counters":6,"goals":89,"health_episodes":7,"health_nudges":13,"items":892,"limits":0,"model_ledger":46,"monitor_deaths":43,"monitor_identity":256,"monitor_lease":1,"pause_reports":0,"pauses":0,"projects":4,"session_tasks":253,"sessions":294,"spend":281,"workstreams":26}
after  (identical)
project-manager insert ok; fk violations: 0
```

## Decisions
Logged in `docs/multi-manager/pm-role/decisions.md` (2026-11-03; moved there in round 1). Choices: separate `stop_project_manager` tool; tab name `mm-<project>-project-manager` (not `-pm`, which #286 holds); `team_health`/`record_nudge` accept a project manager.

## Gaps
- `src/roster/status.ts` and `hooks/` (out of scope) still only know architects: a running project manager will not show in the status tree or sidebar until task 012. `hooks/roster-view.ts` has an `'architect'` check.
- The live roster server and plugin were not restarted; the live database migrates the first time a new-code server opens it. An old-code server running at the same time would still work (it only writes old roles).
- Monitor stuck check treats a project manager's "unfinished work" as goals on its `pm` workstream, like an architect.
- No click-through: no UI changed.

## Round 1 (send-back)
1. `db.ts`: the post-rebuild check now looks only at references to `sessions` (`foreign_key_list` per table, then `foreign_key_check(table)` filtered to parent `sessions`). Test: old database with an orphan goal row still migrates.
2. `db.ts`: the row copy takes only columns both tables have. Test: old table with an extra `stray` column migrates, ids and names kept, the column is gone.
3. `tools-recovery.ts`: in `restore_all`, an architect whose project manager was not restored (replaced, paused-skipped or relaunch failed) is re-parented to the project's running project manager, else the front desk, before it restarts; the result lists it under `reparented`. Tests: replaced manager (architect goes under the newer one) and failed relaunch (architect goes under the front desk).
4. `tools-monitor.ts`: message now says "this project's architect or project manager".
5. Decisions entry moved to `docs/multi-manager/pm-role/decisions.md`; `docs/multi-manager/decisions.md` is back to its base-commit content (no diff against it).
6. Test: a project manager not running when the pause started has no report row, so `resume` does not relaunch it and its architects go under the front desk. Note: a manager that was running but never called `report_paused` still has a row, and `resume` relaunches it with "no resume note was reported" (same as architects today). I read "never reported" as "not in the pause", say if you meant the other case.

Run: same 16 files as above: `ℹ tests 142`, `ℹ pass 142`, `ℹ fail 0`. Typecheck and lint clean.
