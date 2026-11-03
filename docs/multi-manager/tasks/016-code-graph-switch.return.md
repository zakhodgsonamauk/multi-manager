# 016 — return report (round 2, after send-back round 1)

Branch: `worktree-mm-multi-manager-graph-watcher-dev-016-code-graph-switch`.

## What changed
A project can now switch code-review-graph on or off. New roster setting `code_graph` (off by default, added to old rosters on open) and new command `set_code_graph {project, enabled}`.
- On: checks the tool is installed, adds the tool connection in the project folder (`claude mcp add-json ... -s local`, skipped if `claude mcp get` already succeeds), adds the folder to the watch list.
- Off: removes both; "not found" counts as success.
- The value is stored only after the commands succeed. Allowed for the front desk and that project's running project manager; refused for architects, developers and other projects' managers.
- Files: `src/codegraph/codegraph.ts` (new), `src/roster/db.ts`, `src/roster/projects.ts`, `src/roster/tools.ts` (tool plus optional `codeGraphRunner` on `ToolContext`). Tests: `test/codegraph.test.ts`, `test/code-graph-tool.test.ts` (new); `test/projects.test.ts`, `test/db.test.ts`, `test/server.test.ts` extended.

## Send-back round 1: all nine points fixed
1. No shell. Spawn options come from the pure helper `codeGraphSpawnOptions`; test pins no `shell`, `windowsHide: true`, timeout.
2. Options carry `env: launchEnv()`; test pins `CLAUDECODE` / `CLAUDE_CODE_*` dropped.
3. Runner is async (`execFile`); `enableCodeGraph`, `disableCodeGraph` and the tool handler are async.
4. "Not found" matches only the two real messages, each only for its own command. Tests: a "No such file or directory" crash is a failure; each wording does not excuse the other command.
5. `add-json` skipped only when `claude mcp get` output has `Scope: Local config`. Test: a User-scope hit still adds.
6. Half-done failures name what was changed and say running the same command again finishes it. Unit and tool-level tests (flag not stored on enable failure, flag stays on after failed disable).
7. Test: stopped project manager of the same project is refused.
8. Dead ternary removed (test file rewritten).
9. `decisions.md` entry updated.

## Tests run
`node --test test/codegraph.test.ts test/projects.test.ts test/db.test.ts test/server.test.ts test/code-graph-tool.test.ts`
```
ℹ tests 37
ℹ pass 37
ℹ fail 0
```
`npx tsc --noEmit -p tsconfig.json` — no output, exit 0.
`npx eslint .` — no output, exit 0.
Full suite not run, per task scope. No real `claude mcp` or `code-review-graph` command was run.

## Screenshots
None; no UI.

## Decisions made
Logged in `docs/multi-manager/decisions.md` (2026-11-03, Task 016).

## Gaps
- The real runner (`realCodeGraphRunner`) is not exercised by tests, by design; spawn options are.
- The "absent" and `Scope: Local config` wordings come from the architect's check on this PC; they could change in a later tool version.
- Briefings do not mention `set_code_graph` yet (task 019).
