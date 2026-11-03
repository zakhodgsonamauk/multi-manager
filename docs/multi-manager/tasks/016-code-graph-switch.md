# 016 — Per-project code-review-graph switch

Goal #102. Branch: `worktree-mm-multi-manager-graph-watcher-dev-016-code-graph-switch`. Return report: `docs/multi-manager/tasks/016-code-graph-switch.return.md` on that branch.

Background: `docs/multi-manager/graph-watcher/report.md`, `changes.md`, `pm-ownership-plan.md`.

## Goal
A project's project manager decides whether its project uses code-review-graph, a local code-search tool. A new roster setting `code_graph` (off by default) and a new roster command `set_code_graph` switch it.
- Switching on adds the tool connection for the project's folder, local to that folder, and adds the folder to the tool's watch list.
- Switching off removes both.

## Tests first
- `test/codegraph.test.ts` (new), against a fake command runner (records calls, returns scripted results):
  - `enableCodeGraph(project)` runs `claude mcp add-json code-review-graph <json> -s local` with `cwd` = project folder, and `code-review-graph daemon add "<folder>"`.
    - The JSON is exactly the server spec below.
    - If `claude mcp get code-review-graph` (run in that folder) already succeeds, `add-json` is skipped. This makes it safe to run twice.
  - `disableCodeGraph(project)` runs `claude mcp remove code-review-graph -s local` in the folder and `code-review-graph daemon remove "<folder>"`. A "not found" result counts as success.
  - Every spawn uses `windowsHide: true` and a timeout. Check that the runner received both.
  - When the tool is not installed (`code-review-graph --version` fails), enable returns a clear error and changes nothing.
- `test/projects.test.ts`: `getCodeGraph`/`setCodeGraph` round-trip. A new project defaults to off.
- `test/db.test.ts`: an older roster without the column gains `code_graph` (default 0) on open, in the same style as the `standing_rules` test.
- `test/signoff-tools.test.ts` style (or a new `test/code-graph-tool.test.ts`):
  - `set_code_graph` is allowed for the front desk and for the running project manager of that project.
  - It is refused for an architect, for a developer, and for another project's project manager.
  - On success it stores the value only after the command module reports success.
- `test/server.test.ts`: add `set_code_graph` to `ALL_TOOLS`.

Server spec (same as part 1; keep it in one constant):
`{"type":"stdio","command":"code-review-graph","args":["serve"],"env":{"CRG_OPENAI_BASE_URL":"http://127.0.0.1:11434/v1","CRG_OPENAI_API_KEY":"ollama","CRG_OPENAI_MODEL":"qwen3-embedding-ctx2048:4b","CRG_OPENAI_DIMENSION":"512"}}`

## Files expected to change
- `src/codegraph/codegraph.ts` (new): command runner type, server spec constant, `enableCodeGraph` and `disableCodeGraph`.
- `src/roster/db.ts`: one `ADDED_COLUMNS` entry, `code_graph INTEGER NOT NULL DEFAULT 0`.
- `src/roster/projects.ts`: `Project.code_graph`, `getCodeGraph`, `setCodeGraph`.
- `src/roster/tools.ts`: register `set_code_graph {project: string, enabled: boolean}`. Copy the permission pattern from `set_project_rules` (around l.182-197).
- The tests above.

## Out of scope
- Launch, stop and watcher start/stop logic (tasks 017, 018).
- Briefings and commands (task 019).
- The pane.
- Never run real `claude mcp` or `code-review-graph` commands in tests, and never edit `~/.claude.json` by hand in code: always go through `claude mcp`.

## Test scope
`node --test test/codegraph.test.ts test/projects.test.ts test/db.test.ts test/server.test.ts test/code-graph-tool.test.ts`, then `npx tsc --noEmit` and the project's lint (`npm run check` minus the test step, or `.claude\check.cmd` if it allows a non-test run). Never the full suite.

## Evidence required
The pass/fail summary lines of the focused tests, typecheck and lint output.
