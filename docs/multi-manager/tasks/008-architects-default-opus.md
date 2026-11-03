# 008 — Architects and project managers start on Opus by default

Goal #83 (workstream `opus-default`, branch `main`). Return report: `docs/multi-manager/tasks/008-architects-default-opus.return.md` on your branch.

## Goal
The user's words (verbatim): "all architects and pms shouldbe opus by default - infact, that needs to be a development target for multi-manager itself"

Today an architect (project managers are architects too, on a `pm` workstream) launches on the project's default model, and on `sonnet` when the project has none (`resolveLaunchModel` in `src/roster/models.ts`, called through `modelFor` in `src/launch/launcher.ts`). Change the rule so:

- **Architect, no explicit model** -> `opus`, whatever the project default is (set or not). The project default no longer affects architects.
- **Architect, explicit model** (the `model` input to `launch_architect`, or a model recorded on the session from an earlier run or a `set_session_model` step-down) -> that model, unchanged. So `restart_architect`, `restore_all` and resume-after-pause keep a recorded model, and only a session with no recorded model gets `opus`.
- **Developer** -> unchanged: explicit model, else scores, else project default, else `sonnet`.
- **New projects** (`add_project`) -> nothing to store: the architect rule above already covers them. Leave `default_model` null on insert.

## Tests first (each must fail before the change)
In `test/models.test.ts`:
- architect, no override, project default null -> `opus`.
- architect, no override, project default `haiku` (and `sonnet`) -> `opus`.
- architect with override `sonnet` -> `sonnet`.
- developer unscored, no project default -> still `sonnet`; developer unscored with project default `haiku` -> `haiku`.

In `test/launch-model.test.ts`, replace "an architect launches on sonnet when the project has no default" and "an architect launches on the project default when one is set" with:
- an architect launches on opus when the project has no default;
- an architect launches on opus even when the project default is haiku;
- a restarted architect with a recorded `sonnet` model comes back on `sonnet`; one with no recorded model comes back on `opus` (use `restartArchitect`; see the existing restart tests in `test/recovery.test.ts` / `test/change-model.test.ts` for the setup).

Fix any other existing test that asserted the old architect fallback (`grep -rn sonnet test/`), changing only what the new rule requires.

## Files expected to change
- `src/roster/models.ts` (rule and its header comment), `src/launch/launcher.ts` (`modelFor` comment; the restart comment "gets the project default").
- `src/roster/tools.ts`: `set_project_default_model` description says it sets the model for a project's **developer** tabs with no task scores; architects always start on Opus unless stepped down. `launch_architect` description too, if it mentions the model.
- `briefings/front-desk.md`, the line about `set_project_default_model`: add that architects and project managers start on Opus by default; step one down with `set_session_model`.
- `briefings/architect.md`, "Choosing a model" section: one line saying architects run on Opus by default.
- `README.md` if it describes the model rule.
- The tests above.

## Out of scope
The developer score-to-tier rule. The front desk's own model (launched by `front-desk.bat`). Changing any project's stored `default_model` in the live roster. Restarting the roster server, the plugin or any running tab. Pushing (the architect pushes after merge).

## Test scope
`node --test test/models.test.ts test/launch-model.test.ts test/change-model.test.ts test/recovery.test.ts test/briefings.test.ts`, then `npm run typecheck` and `npm run lint`. No full suite.

## Evidence required
Pass/fail summary lines of the focused run. The diff of `resolveLaunchModel`. Never launch a real tab.
