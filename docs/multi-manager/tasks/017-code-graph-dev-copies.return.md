# Return: 017 — developers' copies get code-review-graph

## What changed
When a project's `code_graph` is on, a developer's tab starts with `--mcp-config <rosterDir>\sessions\<id>.mcp.json`. The file holds the 016 server spec plus `CRG_REPO_ROOT` = project folder. Off: nothing changes. Architects and project managers never get it.
- `src/codegraph/codegraph.ts`: `devMcpConfig(projectFolder)`.
- `src/launch/command.ts`: `LaunchSpec.mcpConfigPath/mcpConfigContent`, `claudeArgs` adds `--mcp-config <path>` before `--plugin-dir`, so another option always follows it (no `--strict-mcp-config`), `buildLaunchCommand` returns `mcpConfig`.
- `src/launch/wrapper.ts`: `SessionFiles.mcp`.
- `src/launch/launcher.ts`: decides per launch (developer + `code_graph` 1), writes the file, removes it in launch, `stopSession`, `markClosed`.
- Tests: `command.test.ts` (3 new), `launcher.test.ts` (4 new, removal list updated), `wrapper.test.ts` (files list).

## Tests
`node --test test/command.test.ts test/launcher.test.ts test/wrapper.test.ts test/codegraph.test.ts`
```
ℹ tests 63
ℹ pass 63
ℹ fail 0
```
`npm run typecheck` (tsc --noEmit): no output, clean. `npm run lint` (eslint .): no output, clean.

## Generated .mcp.json (from the launcher test)
```json
{
  "mcpServers": {
    "code-review-graph": {
      "type": "stdio",
      "command": "code-review-graph",
      "args": ["serve"],
      "env": {
        "CRG_OPENAI_BASE_URL": "http://127.0.0.1:11434/v1",
        "CRG_OPENAI_API_KEY": "ollama",
        "CRG_OPENAI_MODEL": "qwen3-embedding-ctx2048:4b",
        "CRG_OPENAI_DIMENSION": "512",
        "CRG_REPO_ROOT": "C:\work\alpha"
      }
    }
  }
}
```
(Test output is pretty-printed; the file is the same JSON.)

## Decisions
See decisions.md, 2026-11-03.

## Gaps
No live check that `claude --mcp-config` with `CRG_REPO_ROOT` really makes the tool search the main index; not tested against a real tab (no tabs popped). No screenshots.

## Send-back round 1
Fixed: `--mcp-config <path>` now goes before `--plugin-dir` (it takes several values, so the prompt was being read as a second config). The prompt is last again. `test/command.test.ts` now asserts the argument after the path starts with `--` and the prompt is last. The launcher test already checks the flag and path.
