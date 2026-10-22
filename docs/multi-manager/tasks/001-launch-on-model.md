# 001 — Launch every tab on its chosen model, and let a running tab change model

Goal #15. Branch: `worktree-mm-multi-manager-main-dev-001-launch-model`. Return report: `docs/multi-manager/tasks/001-launch-on-model.return.md` on that branch.

## Goal
Today a launched architect or developer tab runs on whatever model Claude Code defaults to. After this task:
- a developer tab runs on the model its task scores pick (haiku / sonnet / opus), an architect on the project default (else sonnet);
- the front desk (or a developer's own architect) can step a running tab up or down, and the tab relaunches on the new model with its conversation kept;
- every relaunch path (restart an architect, restart a developer, restore after a reboot) keeps the session's recorded model instead of silently dropping it;
- the architect can log a manual Fable pull, and the front desk can list where models were changed.

This is plan tasks 6, 7 and 8 of the local plan `conductor/tracks/clusters_models_20261022/plan.md` (read it in the project folder `I:\Dropbox (Personal)\Projects\multi-manager`, it is git-ignored so it is not in your copy). Its code is a good start but has known defects listed below; fix them, do not copy them.

Already merged on `main` and available: `src/roster/models.ts` (`resolveLaunchModel`, `resolveModelTier`, `WORK_MODELS`, `isWorkModel`), `--model` in `claudeArgs` and `modelChangePrompt` in `src/launch/command.ts`, the schema (`sessions.model/complexity/clarity`, `projects.default_model`, `model_ledger`) with `setSessionModel`, `setSessionScores`, `getProjectDefaultModel`, `setProjectDefaultModel`, and `src/roster/model-ledger.ts` (`recordModelChange`, `listModelUsage`).

## Tests first
1. `test/launch-model.test.ts` (plan task 6), with these fixes to the plan's version:
   - import `Command` from `../src/launch/command.ts` (runner.ts does not export it);
   - the architect test must use a project with **no** running architect (the plan's version pre-registers one, so `launchArchitect` returns the existing session and launches nothing);
   - add: an architect launches on the project default when one is set (`setProjectDefaultModel` → `'opus'`);
   - add: an unscored developer falls back to the project default;
   - assert the session row's `model` (and `complexity`/`clarity` when scored) is recorded;
   - every test closes its own database, and every temp folder is removed (keep a list, not one shared variable — Windows refuses to delete an open database file).
2. `test/change-model.test.ts` (plan task 7), same clean-up rules, plus:
   - running developer → relaunched with `--resume <conversation>` and `--model opus`, ledger untouched by the function itself (the tool records it);
   - stopped session → model recorded, nothing launched;
   - running session whose conversation cannot be restored → relaunched fresh, and the prompt still carries the developer's original task (from the saved task) or the architect's role prompt — the plan's version loses it;
   - front desk session → refused.
3. Relaunch keeps the model: extend the existing restart tests (find them with a search for `restartArchitect` and `restart_developer` / restore in `test/`) so a session with `model = 'opus'` relaunches with `--model opus`.

## Files expected to change
- `src/launch/launcher.ts` — `TabSpec.model` passed into `buildLaunchCommand`; model resolution + recording in `launchArchitect` / `launchDeveloper` (developer input gains optional `complexity`, `clarity`); new `changeSessionModel`; `restartArchitect` passes `old.model`.
- The developer-restart and restore code (`src/roster/tools-health.ts`, `src/roster/tools-recovery.ts`, or wherever they call `launchTab`) — pass the stored model.
- `src/roster/tools.ts` — `launch_developer` accepts `complexity` / `clarity` (1-5, optional); new tools `set_session_model`, `set_project_default_model`, `log_model_use`, `model_usage`.
- `test/launch-model.test.ts`, `test/change-model.test.ts`, the restart/restore tests you extend.

Known defects in the plan's tool code to fix:
- handlers that `await` must be `async` (`guard(async () => …)`, check how `guard` is typed);
- the plan's `model_usage` registration is not valid code (the handler is inside the options object);
- permission rule for `set_session_model`: the front desk may change any architect or developer; an architect may change only its own developers; nobody may change their own session through this tool (it would kill the caller mid-call); the front desk's own model is never changed.

## Out of scope
- The front-desk picker, `front-desk.bat`, README (task 002).
- `briefings/` and `commands/set-model.md` (already merged).
- Do not restart, stop or relaunch any live session on this PC. This repo is the tool every running session uses; nothing you do may touch the live roster database (`%USERPROFILE%\.claude\multi-manager\roster.db`). Tests use temp databases only.

## Test scope
- `node --test test/launch-model.test.ts test/change-model.test.ts` plus the restart/restore test files you touched, and `test/command.test.ts`, `test/models.test.ts`.
- `npm run typecheck` and `npm run lint`.
- `claude plugin validate .`
- Not the full suite.

## Evidence required
- Each command above with its summary lines pasted verbatim.
- A short list of every relaunch path you found and how each now carries the model.
