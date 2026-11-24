# 031 — MCP servers through a middle-man

Goal #2. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/031-mcp-middle-man.return.md` on that branch.

Runs after 029 is merged, and only if 029's measured saving shows this one is worth it. The architect decides from 029's before/after numbers.

## The user's words (sign-off item #2, Q2)
"ideally we'd wrap plugins in some sort of middle-man so they're still available, but only stuck into context when relevant."

## Goal
Every Multi-Manager tab also loads all the user-level tool connections: blender, open-banking, reddit, atlassian, claude-context-sync and others. Their tool names (about 5.6k tokens) and server instructions (about 2k tokens) sit in every session's start-up text, which is re-read on every call. Most Multi-Manager work never uses them.

After this task, Multi-Manager tabs load only these tool connections directly:
- the roster;
- the Chrome browser tools;
- second-opinion;
- code-review-graph.

They also load one small "broker" connection with three tools:
- `find_tool(query)` searches the other servers' tools by name and description;
- `describe_tool(server, tool)` returns a tool's input schema;
- `call_tool(server, tool, args)` starts that server on first use, forwards the call, and returns the result.

The servers are read from the user's own MCP config, read-only. The user's normal sessions do not change.

## Levers
- `--strict-mcp-config` together with Multi-Manager's own `--mcp-config` file. Only the listed servers load.
- The broker uses the MCP SDK client (`@modelcontextprotocol/sdk` is already a dependency) to talk to the real servers.
- It starts each server lazily and stops idle ones after a few minutes, to keep the PC lean.

## Tests first
- `claudeArgs` for an architect or developer includes `--strict-mcp-config`, and the generated MCP config lists the keep-list plus the broker.
- Broker with a fake stdio MCP server:
  - `find_tool` finds its tool;
  - `describe_tool` returns the schema;
  - `call_tool` returns the result;
  - the server process is started only on the first call and stopped after the idle timeout.
- A server that fails to start gives a clear error, not a hang.

## Files expected to change
- `src/launch/command.ts`
- where the `--mcp-config` file is written
- a new `src/broker/` (server, index, lifecycle)
- `.claude-plugin` or `package.json` entries if the broker is its own server process
- tests

## Out of scope
- claude.ai connectors (029 turns them off).
- Skills (029).
- Editing the user's MCP config.

## Test scope
The new broker tests and `node --test test/command.test.ts`, then `npm run typecheck` and `npm run lint`. Never run the full suite.

## Evidence required
- Test summary lines.
- A real launched architect in a throwaway project (ask first). Show:
  - its first-turn context size before and after;
  - one real call through the broker to a user server, for example reddit's hot threads or blender's addon status;
  - no leftover server processes afterwards.
