# 017 — Developers' temporary copies get code-review-graph when the project has it on

Goal #102. Needs 016 merged. Branch: `worktree-mm-multi-manager-graph-watcher-dev-017-code-graph-dev-copies`. Return report: `docs/multi-manager/tasks/017-code-graph-dev-copies.return.md` on that branch.

## Goal
Today the tool connection is local to the project's main folder. A developer working in `<project>\.claude\worktrees\<name>` doesn't get it.

When the project's `code_graph` is on, a developer's tab is started with an extra tool-connection file:
- It holds the same server spec as task 016, plus `CRG_REPO_ROOT` set to the project's main folder.
- That makes the tool search the main project's index instead of trying to build one for the copy.

When `code_graph` is off, nothing changes in the launch.

## Tests first
- `test/command.test.ts`:
  - With `spec.mcpConfigPath` set, `claudeArgs` contains `--mcp-config <path>` before the prompt, and does NOT contain `--strict-mcp-config`, which would drop the plugin's own roster tool.
  - Without it, the arguments are unchanged.
- `test/launcher.test.ts`:
  - Launching a developer for a project with `code_graph` on writes `<rosterDir>\sessions\<id>.mcp.json`. Its content is `{"mcpServers":{"code-review-graph":{...spec, env:{...spec.env, CRG_REPO_ROOT:<project folder>}}}}`, and the launch passes that path.
  - With `code_graph` off, no file is written and no flag is passed.
  - Architects and project managers never get the file: they run in the main folder, which already has the local connection.
- `test/launcher.test.ts` or `wrapper.test.ts`: stopping or closing the session removes the `.mcp.json` file along with the other state files (`markClosed` and `stopSession`).

## Files expected to change
- `src/launch/command.ts`: `LaunchSpec.mcpConfigPath?`, `claudeArgs`, and `buildLaunchCommand` returning the extra file to write.
- `src/launch/launcher.ts`: decide per launch (developer + `code_graph` on), and include the file in state-file clean-up.
- `src/launch/runner.ts` or wherever the settings file is written: write the new file.
- `src/codegraph/codegraph.ts`: export a `devMcpConfig(projectFolder)` helper that builds the JSON.
- The tests above.

## Out of scope
- The watcher (task 018).
- Changing `dev-copy.ts`.
- Any change for architects or project managers.

## Test scope
`node --test test/command.test.ts test/launcher.test.ts test/wrapper.test.ts test/codegraph.test.ts`, then typecheck and lint. Never the full suite.

## Evidence required
- Focused test summary lines, typecheck and lint output.
- One generated `.mcp.json` from a test, pasted into the return report.

## Send-back round 1 (2026-11-03)
1. `src/launch/command.ts:92` — `--mcp-config` is variadic (`claude --help`: `--mcp-config <configs...>  Load MCP servers from JSON files or strings (space-separated)`). Placed directly before the prompt, the prompt is read as a second config and the tab starts with no prompt (and a bad config). The task file wrongly said "before the prompt"; my mistake. Fix: push `--mcp-config <path>` before `--plugin-dir`, so another option always follows it.
2. `test/command.test.ts` — the new test must assert that the argument right after the path starts with `--`, and that the prompt is still last.
Same test scope. Update the return report, raise done again.
