# 013 return — project manager briefing, skills, routing, README

## What changed
- `briefings/project-manager.md`: full role (replaces placeholder).
- `commands/pm-intake.md`: new skill.
- `commands/tick.md`: project manager branch; front desk line about nested `team_health`; `argument-hint` quoted (the unquoted text broke `claude plugin validate`).
- `briefings/front-desk.md`: routing section (project manager first, `launch_project_manager`, `set_project_rules`, direct sign-offs).
- `briefings/architect.md`: nudge whoever the item is addressed to (+ `watcher_nudge`), "Who gets what" section.
- `commands/plan-goal.md`, `wrap-goal.md`: same nudge wording. `dispatch.md` had no front-desk wording: unchanged. `start-architect.md`, `stop-architect.md`, `status.md`: mention project managers.
- `README.md`: four-level team, project managers, standing rules.
- Tests: `test/briefings.test.ts` (project manager checks, size rule, every snake_case tool name in briefings/commands is a registered tool, taken from `ALL_TOOLS` in `test/server.test.ts`); `test/plugin-manifest.test.ts` (`pm-intake` front matter and key steps).

## Tests
- Before the docs: new checks failed (missing `pm-intake.md`, project manager briefing patterns).
- `node --test test/briefings.test.ts test/command.test.ts test/plugin-manifest.test.ts`: `ℹ tests 34`, `ℹ pass 34`, `ℹ fail 0`.
- `npm run lint`: clean (no output after `eslint .`).
- `claude plugin validate .`: `✔ Validation passed` (also prints the standing note about the directory submission safety scan, not new).

## Word counts (before → after)
- front-desk 908 → 1051
- architect 1080 → 1154 (character cap raised 7000 → 7500, commented in the test)
- project-manager 135 → 635 (shorter than architect, now a test)
- developer 395 (unchanged)

## Decisions
- Working copies on this machine are CRLF; the front-matter and length tests read files raw and failed before my change. The tests now normalise `\r\n`.
- Reply field and argument names (`watcher_nudge`, `session_id`, `at_least`, `recommended_action`, `to_model`, `claude_session_id`) are exempt from the tool-name check.
- Task 012 not read in code: the briefing and tick describe its view only as "`team_health` nests architects under their project manager".

## Gaps
- Not live-tested with a running project manager (out of scope). `docs/multi-manager/pm/` is named in the briefing but no templates exist yet.
