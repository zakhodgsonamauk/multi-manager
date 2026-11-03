# 008 return: architects and project managers start on Opus

## What changed
- `src/roster/models.ts`: `resolveLaunchModel` now checks architects first. An explicit model (or one recorded on the session) wins. Otherwise an architect gets `opus`, whatever the project default is. Developers are unchanged: explicit model, then scores, then project default, then `sonnet`. Header comment and `projectDefaultModel` comment updated to match.
- `src/launch/launcher.ts`: two comments updated (`modelFor`, and the restart comment that said "gets the project default"). No logic change here; the rule lives in `resolveLaunchModel`.
- `src/roster/tools.ts`: `set_project_default_model` description now says it applies to developer tabs, and architects ignore it and start on Opus unless stepped down. `launch_architect` description does not mention the model, so unchanged.
- `briefings/architect.md`: one line under "Choosing a model for each task" saying architects run on Opus by default.
- `briefings/front-desk.md`: sentence added to the `set_project_default_model` line: it applies to developers only, architects and project managers start on Opus, step one down with `set_session_model`.
- `README.md`: checked, does not describe the model rule, so unchanged.
- `add_project`: already stores `default_model` as null on insert. Unchanged.

## Diff of `resolveLaunchModel`
```
 export function resolveLaunchModel(input: ResolveModelInput): string {
   if (input.modelOverride !== null && input.modelOverride !== '') return input.modelOverride;
-  if (input.role === 'developer' && isValidScore(input.complexity) && isValidScore(input.clarity)) {
+  if (input.role === 'architect') return 'opus';
+  if (isValidScore(input.complexity) && isValidScore(input.clarity)) {
     return resolveModelTier(input.complexity, input.clarity);
   }
   return input.projectDefaultModel ?? 'sonnet';
```

## Tests
Tests written first (new architect cases failed before the rule change):
- `test/models.test.ts`: developer fallback split out (kept); new architect cases: no override and default null/haiku/sonnet -> `opus`; architect with override `sonnet` -> `sonnet`.
- `test/launch-model.test.ts`: the two old architect tests replaced with: launches on `opus` with no default; launches on `opus` with default `haiku`; restart keeps recorded `sonnet`, and with no recorded model comes back on `opus`.
- Fallout fixed (only what the rule requires):
  - `test/change-model.test.ts`: the architect in the set-model test now records `opus` (ledger `from_model` updated); the failed-relaunch test's architect now starts at `opus` and its attempted step goes to `sonnet` (so the attempt is a real change).
  - `test/recovery.test.ts`: the "no recorded model" restart test now sets the project default to `haiku` and expects `opus`, renamed to say the default is ignored.

Focused run after writing the new tests, before the rule change: 4 failing (the 4 new architect cases), 11 passing in those two files. Then the rule change, then the 3 fallout tests fixed; the final run is below.

Focused run, after the change:
```
ℹ tests 49
ℹ pass 49
ℹ fail 0
```
Full command: `node --test test/models.test.ts test/launch-model.test.ts test/change-model.test.ts test/recovery.test.ts test/briefings.test.ts` (exit 0).

Before any edit, the same five files ran clean on the original code: `ℹ pass 46`, `ℹ fail 0`.

Typecheck: `npm run typecheck` -> `tsc --noEmit -p tsconfig.json`, exit 0, no errors.
Lint: `npm run lint` -> `eslint .`, exit 0, no errors.

## Screenshots
None. No page or UI changed.

## Decisions
- The decision entry "Architects ignore the project default; a recorded model still wins" was already in `docs/multi-manager/opus-default/decisions.md` (written by the architect). I did not add a second one.
- Restarts keep a recorded model, so a step-down survives restart, restore and resume. Only a session with no recorded model gets `opus`.

## Gaps
- No full suite run (out of scope per the task).
- No real architect tab launched (per the task). The launcher tests capture the exact `--model` argument instead.
- The live roster's stored `default_model` values were not changed (out of scope). Existing projects with a stored default will now affect developers only.
- Running tabs and the plugin server are not restarted, so the new rule takes effect only after a restart of the roster server.
- Not pushed (the architect pushes after merge).
