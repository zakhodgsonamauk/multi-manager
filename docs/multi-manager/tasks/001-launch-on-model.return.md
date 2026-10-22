# 001 — return report (round 1)

Branch: `worktree-mm-multi-manager-main-dev-001-launch-model`. Last code commit: `7ca2023` (decisions `83ea20d`, this report on top).

Before starting, the branch was fast-forwarded to `main` (`git merge --ff-only main`) on architect #46's instruction: it had been created from an old version without the task file or the model code. No own commits existed at that point.

## What changed
- **Every new tab runs on a chosen model.** `launchArchitect` and `launchDeveloper` (`src/launch/launcher.ts`) work out the model: an explicit model, else the task scores (developers only), else the project default, else sonnet. It goes into `--model` and onto the session row. Developers also get `complexity` / `clarity` recorded when scored. The row is written in the shared launch step (`launchTab`), so every launch path records it the same way.
- **A running tab can change model.** New `changeSessionModel` closes only that session's own process and relaunches it under the same roster id on the new model with `--resume <conversation>`. If the conversation is gone, it starts fresh and the prompt still says who it is: the architect's role line, or the developer's full original prompt with its stored task, followed by the model-change note. A stopped session only has the model recorded. The front desk is refused. The function does not write the ledger; the tool does. The session keeps its claims, and its children keep running.
- **Relaunches keep the model** (every path found):
  - `restart_architect` and `restore_all` → `restartArchitect` passes the stored model. A session with no stored model gets the project default, else sonnet, and that is then recorded.
  - `restart_developer` (`src/roster/tools-health.ts`) → passes the old developer's model and scores to `launchDeveloper`.
  - `resume` after a pause (`src/roster/tools-pause.ts`) → passes the old architect's model to `launchArchitect`. This path was not named in the task, but it relaunches a tab, so it is covered too.
  - `changeSessionModel` → the new model, by design.
- **Tools** (`src/roster/tools.ts`): `launch_developer` takes optional `complexity` / `clarity` (whole numbers 1-5). New tools:
  - `set_session_model` (async handler). Rule: the front desk may change any architect or developer; an architect only its own developers; nobody their own session; never the front desk. It writes the ledger with the model it had before the change.
  - `set_project_default_model` (front desk only; null clears it).
  - `log_model_use` (architects only).
  - `model_usage` (valid registration: options object, then handler).

  `test/server.test.ts` lists the four new tool names.

## Tests run
`node --test test/launch-model.test.ts test/change-model.test.ts`
```
✔ stepping a running developer up relaunches it on the new model with its conversation, same roster id (58.8287ms)
✔ changing a stopped session records the model and launches nothing (39.9091ms)
✔ a developer whose conversation is gone is relaunched fresh with its original task (39.4821ms)
✔ an architect whose conversation is gone is relaunched fresh with its role prompt (40.187ms)
✔ the front desk model is never changed (26.1558ms)
✔ set_session_model: front desk changes anyone but itself, an architect only its own developers, nobody themselves (48.923ms)
✔ set_project_default_model, log_model_use and model_usage (43.3913ms)
✔ a hard, vague task launches its developer on opus and records model and scores (49.7225ms)
✔ a small, fully specified task launches its developer on haiku (26.9734ms)
✔ an architect launches on sonnet when the project has no default (20.0593ms)
✔ an architect launches on the project default when one is set (30.9616ms)
✔ an unscored developer falls back to the project default, and leaves its scores empty (40.9145ms)
✔ an unscored developer with no project default runs on sonnet (34.2151ms)
✔ an explicit model wins over scores and the project default (30.949ms)
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

Restart/restore test files touched (`recovery`: restart_architect + restore_all keep the model, null model falls back to the default; `health`: restart_developer keeps model and scores; `pause`: resume keeps the model) plus the tool-list test:
`node --test test/recovery.test.ts test/health.test.ts test/pause.test.ts test/server.test.ts`
```
ℹ tests 30
ℹ pass 30
ℹ fail 0
```

`node --test test/command.test.ts test/models.test.ts test/launcher.test.ts` (launcher added because every launch now carries `--model`)
```
ℹ tests 32
ℹ pass 32
ℹ fail 0
```

`npm run typecheck` → `tsc --noEmit -p tsconfig.json`: no output, no errors.
`npm run lint` → `eslint .`: no output, no errors.
`claude plugin validate .` → `✔ Validation passed` (one advice line about a marketplace install line in README, unrelated).

Tests use temp databases through the `tempRoster` helper. Each test closes its own database and deletes its own temp folder (`t.after`). Nothing touched the live roster, and nothing real was launched or killed (fake launcher).

## Screenshots (opened and judged)
- None. This task has no screen. The real-tab check is the plan's click-through (task 14).

## Decisions made
Logged in `docs/multi-manager/decisions.md` (2026-10-23, "Task 001 detail"):
- A model change keeps the session's claims (same roster id, same conversation). A crash restart still drops them.
- A running session's model change is refused while its project is paused. A stopped one can still be recorded.
- `changeSessionModel` itself accepts only haiku, sonnet or opus, not just the tool.
- A session with no stored model restarts on the project default, else sonnet, and that is recorded.
- `set_project_default_model` is front desk only, matching the front-desk briefing.
- A developer with no name cannot have its model changed while running (its worktree name is unknown).

## Gaps
- `test/briefings.test.ts` fails one test on `main` already: "architect briefing covers its R6 duties and stays tight", with `architect.md is 6692 characters`. It comes from the merged model text in `briefings/architect.md`. Briefings are out of scope for this task, so I did not touch it. It needs trimming (or a raised limit) before the full gate.
- Not checked against real tabs: whether `claude --resume <id> --model opus` really continues the conversation on the new model. That needs the click-through.
- Unit tests do not cover `model_usage`'s `limit`.

---

# 001 — return report (round 2)

Branch: `worktree-mm-multi-manager-main-dev-001-launch-model`. Fix commit: `071dd88` (decisions `9fab6ee`, this report on top).

I read the send-back round with `git show main:docs/multi-manager/tasks/001-launch-on-model.md` and did not run `git merge main`, because the developer rules forbid merging. So this branch's copy of the task file and `test/briefings.test.ts` are older than `main`; the squash-merge will bring in `main`'s versions. Neither file was changed on this branch.

## What changed (one line per send-back point)
1. `changeSessionModel` closes the old process first (`killOwnProcess`), and if nothing provably ours was found or taskkill failed, it throws `Multi-Manager could not close <name>'s tab, model not changed. <why>`. Nothing is launched, and the session stays `running` on its old model.
2. The kill step now takes the caller's warnings list, so the error above says why (for example `Process 4002 is not mm-alpha-main-dev-login's claude.exe any more, so nothing was killed.`). `restartArchitect` still passes a throwaway list, as before: for a dead architect "nothing to kill" is normal, so it would only be noise.
3. `launchTab` writes the session's model only after Windows Terminal opened the tab. If the relaunch fails after a successful close, the session is `stopped`, keeps its old model, its claims are released, and the error ends `It is down and still on <old model>: bring it back with restart_developer (its architect)` (or `restart_architect (front desk)`). The tool writes the ledger only after success, so a failure leaves no ledger row.
4. `set_session_model` with the session's current model returns `note: "already on <model>"`, `relaunched: false`, and writes no ledger row.
5. `modelChangePrompt` is role-aware. A developer is told to `check_in and continue your task where you stopped` (if its conversation is gone, to check its branch and worktree first). An architect keeps the "WAIT for the user's go" line.
6. Tests added to `test/change-model.test.ts` (paused project, process not ours, taskkill fails, relaunch fails after close, same model, front desk steps a developer, no ledger row on failure) and `test/command.test.ts` (developer vs architect wording). `test/health.test.ts` restart_developer now uses scores 1/5 (which map to haiku) with stored model `opus`, and asserts `--model opus`.

## Tests run
`node --test test/launch-model.test.ts test/change-model.test.ts`
```
✔ stepping a running developer up relaunches it on the new model with its conversation, same roster id (37.3816ms)
✔ changing a stopped session records the model and launches nothing (27.7628ms)
✔ a developer whose conversation is gone is relaunched fresh with its original task (31.7192ms)
✔ an architect whose conversation is gone is relaunched fresh with its role prompt (25.923ms)
✔ the front desk model is never changed (24.8318ms)
✔ a paused project refuses to change a running session: nothing closed or launched (24.203ms)
✔ when its process is not provably its own, the tab is not relaunched and the model is not changed (20.3524ms)
✔ when taskkill fails, the tab is not relaunched and the model is not changed (21.598ms)
✔ when the relaunch fails after the kill, the old model stays, claims are released and the error names the restart tool (29.5065ms)
✔ set_session_model: front desk changes anyone but itself, an architect only its own developers, nobody themselves (42.0829ms)
✔ set_session_model: the front desk steps a developer; asking for the current model changes nothing (28.9079ms)
✔ set_session_model writes no ledger row when the change fails (23.8279ms)
✔ set_project_default_model, log_model_use and model_usage (25.1401ms)
✔ a hard, vague task launches its developer on opus and records model and scores (29.0101ms)
✔ a small, fully specified task launches its developer on haiku (29.3665ms)
✔ an architect launches on sonnet when the project has no default (23.5634ms)
✔ an architect launches on the project default when one is set (24.214ms)
✔ an unscored developer falls back to the project default, and leaves its scores empty (28.0996ms)
✔ an unscored developer with no project default runs on sonnet (31.1432ms)
✔ an explicit model wins over scores and the project default (27.7545ms)
ℹ tests 20
ℹ pass 20
ℹ fail 0
```
`node --test test/recovery.test.ts test/health.test.ts test/pause.test.ts test/server.test.ts`
```
ℹ tests 30
ℹ pass 30
ℹ fail 0
```
`node --test test/command.test.ts test/models.test.ts test/launcher.test.ts`
```
ℹ tests 33
ℹ pass 33
ℹ fail 0
```
`npm run typecheck`: no errors. `npm run lint`: no errors (one lint error, an error rethrown without its `cause`, was fixed before commit). `claude plugin validate .` → `✔ Validation passed`.

## Screenshots (opened and judged)
- None. No screen in this task.

## Decisions made
In `docs/multi-manager/decisions.md`, "Task 001 round 2" (two entries): what a failed change leaves behind, and reading the send-back from `main` instead of merging.

## Gaps
- Still unchecked on real tabs: whether `claude --resume <id> --model <m>` continues on the new model. That is the click-through's job.
- If the relaunch fails after the close, the developer's conversation id is kept unless it was already missing. So `restart_developer` starts a new developer session (its normal behaviour) rather than resuming that conversation.
