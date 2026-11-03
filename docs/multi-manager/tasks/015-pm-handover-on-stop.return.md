# Return: 015 stopping an old pm architect hands its architects to the project manager

## What changed (plain words)
- `stop_architect` on an architect with architects running under it now moves those architects (and their developers, items) to the project's running project manager and keeps them running. Only the old pm's own tab and its own developers close. With no project manager running in that project it refuses ("Not stopped: ..."), stops nothing. Architect with only developers: unchanged.
- Pause, `stop_project_manager`, `stop_developer`, idle-stop still stop everything (`stopSession` untouched).
- `src/launch/launcher.ts`: new `stopArchitectSession`, `StopResult` gains optional `handed_over` and `next`.
- `src/roster/items.ts`: new exported `rerouteItems`, reuses `defaultRoute`.
- `src/roster/tools.ts`: `stop_architect` description. `briefings/front-desk.md`, `briefings/project-manager.md`: one entry each. `commands/stop-architect.md`: wording (README does not describe the tool's behaviour).
- `test/pm-handover.test.ts`: new, 8 tests covering all 8 task cases.

## Commands
- `node --test test/pm-handover.test.ts test/launcher.test.ts test/items.test.ts test/pm-role.test.ts test/pause.test.ts test/briefings.test.ts test/plugin-manifest.test.ts` -> `ℹ tests 72 / ℹ pass 72 / ℹ fail 0`
- `npm run typecheck` -> no output after the tsc line (clean)
- `npm run lint` -> no output after the eslint line (clean)
- Captured `next`: `Tell mm-alpha-project-manager it now manages mm-alpha-api, mm-alpha-web (SendMessage "check list_sessions: you now manage mm-alpha-api, mm-alpha-web"), and tell each moved architect its project manager is now mm-alpha-project-manager.`

## Decisions
See `docs/multi-manager/pm-handover/decisions.md` (2026-11-03 entry added).

## Gaps
- Tests were written after the code, not before (all pass; the refusal and item cases would fail without the change).
- No screenshots: no UI change. Nothing real launched, killed, or restarted; throwaway roster only.

## Round 1 (send-back, tests only)
- `test/pm-handover.test.ts` item case: added an architect of the same project under the front desk (not under the old pm) with an open item; asserted it is unchanged. Added an answered item whose `watched_by` is the old pm: afterwards it names the project manager, `addressed_to` unchanged.
- `test/items.test.ts`: new direct test of `rerouteItems` (no launcher): open done moves and becomes unseen; open signoff goes to the front desk watched by the project manager; an item not naming the old session is neither returned nor changed.
- No source change.
- `node --test test/pm-handover.test.ts test/launcher.test.ts test/items.test.ts test/pm-role.test.ts test/pause.test.ts test/briefings.test.ts test/plugin-manifest.test.ts` -> `ℹ tests 73 / ℹ pass 73 / ℹ fail 0`. (One earlier run failed an unrelated restore test when the machine's process listing errored; the rerun passed.)
- `npm run typecheck`, `npm run lint` -> clean.
