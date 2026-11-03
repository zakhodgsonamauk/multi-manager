# 010 — The roster knows the project manager role: launch, stop, restart, restore, pause

Goal #89 (workstream `pm-role`, branch `main`). Developer branch: `worktree-mm-multi-manager-pm-role-dev-010-pm-role` (dev #293). Return report: `docs/multi-manager/tasks/010-pm-role-in-roster.return.md` on your branch.

## Goal
The user's request (verbatim): "we need to formalise the use of a project manager to handle multiple architects (who in turn handle builders/developers)".

Today a project manager is an `architect` row on a workstream called `pm`; the roster does not know the role exists. After this task the roster has a real `project-manager` role: one per project, launched on Opus with its own briefing, sitting between the front desk and that project's architects, and every lifecycle tool (launch, stop, restart, restore, pause/resume, the monitor's death and stuck reports) keeps the tree front desk → project manager → architects → developers intact.

## What we know (architect's findings)
- `sessions.role` has `CHECK (role IN ('front-desk','architect','developer'))` (`src/roster/db.ts:28`). SQLite cannot widen a CHECK in place: `migrate()` must rebuild the table (create new, copy rows, drop, rename, recreate indexes) inside a transaction, only when the old CHECK is present. Migrations today only add columns (`ADDED_COLUMNS`, `db.ts:113-129`); follow its style.
- Role lists: `ROLES` (`src/roster/sessions.ts:4`), `RoleLike` (`src/roster/models.ts:8`), `HealthRole` (`src/monitor/health.ts:17`), and literal `'architect' | 'developer'` in `src/launch/launcher.ts:65,103` and `src/launch/command.ts:22,141`. Full list of role checks from research: `launcher.ts:65,103,220,306,411,419,437,463`; `command.ts:22,65,116-153`; `tools.ts:398,419,454`; `tools-health.ts:48,55,114-115`; `tools-monitor.ts:60`; `tools-recovery.ts:75,88,92,157`; `tools-pause.ts:149,186,213`; `monitor/health.ts:118,211,223`; `monitor/monitor.ts:114,279`; `projects.ts:139`. Check each one; not all need changing.
- `launch_architect` already parents a new architect to its caller (`tools.ts:359`), so architects a project manager launches hang under it. `restart_architect` reuses the same session row (`launcher.ts:304-348`), so children keep their link. `resume` relaunches architects with `parentId: desk.id` (`tools-pause.ts:201`) and loses the link. Monitor death/stuck items for an architect always go to the front desk (`monitor.ts:113-117`, `health.ts:210-214`).
- Model rule: `models.ts:41-54` returns `opus` for architects ("project managers are architects too"). Keep that rule for the new role: explicit model, then recorded model, then `opus`.
- Briefing: `launcher.ts:152` passes `briefings/${role}.md`; `get_briefing` reads the same path (`tools.ts:64-67`).

## Decisions already made (do not reopen)
- The role is named `project-manager`. A project manager session lives on the project's `pm` workstream (created if missing), so its own goals stay addressable as today. Parent: the front desk.
- One running project manager per project: a partial unique index on `project_id` where `role = 'project-manager' AND state = 'running'`.
- No automatic conversion of existing `architect` rows on a `pm` workstream. The running project manager (#286) keeps working as it is until the front desk relaunches it as a project manager after this merges.
- Restart reuses `restart_architect` (front desk only): it accepts a project manager session too. No new restart tool.

## Tests first
Write these first and see each fail. Use `test/helpers.ts` (in-memory roster) and the launcher's captured-command fakes as the existing launch tests do (`test/launcher.test.ts`, `test/launch-model.test.ts`, `test/recovery.test.ts`, `test/pause.test.ts`).
1. `test/db.test.ts`: a database created with the old schema (old CHECK, a few sessions of each role, the running-architect index) migrates: rows and ids kept, `project-manager` insert now allowed, a second running project manager for the same project refused, running-architect index still enforced. Migrating twice is a no-op.
2. `test/launcher.test.ts` (or a new `test/pm-launch.test.ts`): `launch_project_manager` with a project name (front desk caller) creates the `pm` workstream if missing, launches on `opus` with `briefings/project-manager.md` and `MM_ROLE=project-manager`, parent = front desk; a second call while one runs returns the existing one (like `launch_architect`); a non-front-desk caller is refused with a plain message; a recorded model (step-down) wins on relaunch; `goal_id` given → the start prompt names it.
3. Architects launched by a project manager have `parent_id` = the project manager (already true; pin it with a test).
4. `stop_architect` on the `pm` workstream (or a `stop_project_manager`, your choice, log it in the return report) stops the project manager and, as today, its running children.
5. `restart_architect` with a project manager session: relaunches it on its recorded model with its briefing, same row id, its architects still its children; with a developer session: still refused.
6. `restorable_sessions` / `restore_all`: a project manager appears with its architects nested under it and their developers under them; restore relaunches the project manager first, then its architects parented to it.
7. Pause/resume: `finish_pause` stops in the order project manager, architect, developer (or whatever order keeps the existing contract: read `tools-pause.ts:149` first); `resume` relaunches the project manager first and parents each of that project's architects to the new project manager session, not the front desk. A project without a project manager behaves exactly as today.
8. Monitor: a dead or stuck architect whose parent is a running project manager raises its item to the project manager; a dead or stuck project manager raises to the front desk; with no running project manager, unchanged.
9. `get_briefing` accepts `project-manager` and returns `briefings/project-manager.md`.

## Files expected to change
`src/roster/db.ts`, `src/roster/sessions.ts`, `src/roster/models.ts`, `src/roster/tools.ts` (new `launch_project_manager` tool, `get_briefing`/`register_session` enums), `src/roster/tools-recovery.ts`, `src/roster/tools-pause.ts`, `src/roster/tools-health.ts` (role checks only; the grouping is task 012), `src/roster/tools-monitor.ts`, `src/monitor/health.ts`, `src/monitor/monitor.ts`, `src/launch/launcher.ts`, `src/launch/command.ts` (project manager start and restart prompts), `src/roster/projects.ts` if `refuseWhileRunning` needs it, new `briefings/project-manager.md` (a short placeholder: role, one per project, launched by the front desk, launches architects, never builds; task 013 writes the full text), tests above. `claim` `src/roster/tools.ts`, `src/roster/db.ts` and `src/launch/launcher.ts` before editing; release after your return.

## Out of scope
`src/roster/status.ts`, `hooks/` (the sidebar and status tree are task 012, after goal #85's task 009 merges). Item routing and standing rules (task 011). Briefing and skill text beyond the placeholder, README (task 013). Restarting or reloading the roster server, the plugin, the pane or any Windows Terminal tab; launching real tabs. Opening the live roster database for writing. Pushing.

## Test scope
The new and touched test files only: `node --test test/db.test.ts test/launcher.test.ts test/launch-model.test.ts test/recovery.test.ts test/pause.test.ts test/health.test.ts test/monitor.test.ts test/briefings.test.ts test/sessions.test.ts` (plus any new file), then `npm run typecheck` and `npm run lint`. No full suite. Also: copy the live roster database (`~/.claude/multi-manager/roster.db`) to a temp file, open the copy, run the migration on it, and report row counts per table before and after (the live file is never opened for writing).

## Evidence required
Pass/fail summary line of each focused run, typecheck and lint. The migration on the database copy: counts before/after and that a `project-manager` insert succeeds. The exact command line captured for a project manager launch (model, briefing file, `MM_ROLE`).

## Send-back round 1 (2026-11-03)
The review found the work sound and the spec met. These fixes come first because the rebuild runs on the live roster within seconds of merging, and a throw there stops every hook and every new tab from starting.
1. `src/roster/db.ts:167`: `PRAGMA foreign_key_check` runs over the whole database, so an unrelated broken reference anywhere would make the migration throw on every open. Check only the tables involved: `foreign_key_check(sessions)` plus each table that references `sessions`. Test: an old-schema database with a dangling reference in an unrelated table still migrates.
2. `src/roster/db.ts:160`: the copy takes every column of the old table, so a stray column the new table lacks would fail the same way. Copy only the columns present in both tables. Test: an old table with an extra unknown column migrates and the known columns' values are kept.
3. `src/roster/tools-recovery.ts:214-217`: when `restore_all` skips the project manager (paused, replaced, or its relaunch fails), its architects are still relaunched under the stopped manager. Re-parent them to the project's running project manager if one exists, else the front desk, and say so in the result. Test it.
4. `src/roster/tools-monitor.ts:61`: the message says "this project's architect" only; include the project manager.
5. Your decisions went into `docs/multi-manager/decisions.md` (the main workstream's file). Move that entry to `docs/multi-manager/pm-role/decisions.md` and leave the main file as it was on `main`.
6. Add a test for a project manager that never reported paused: `resume` does not relaunch it, and its architects go back under the front desk (pin today's behaviour).
Update your return report (add a "Round 1" section) and raise done again.
