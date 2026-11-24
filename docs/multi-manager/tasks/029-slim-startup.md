# 029 — Smaller start-up text for Multi-Manager tabs

Goal #2. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/029-slim-startup.return.md` on that branch.

Only dispatched if the user says yes to slimming the start-up text in the plan sign-off. Follow the user's answer exactly as written.

## Goal
Every Multi-Manager session starts with about 65-70k tokens of fixed text, and that text is re-read on every call for the life of the session. Most of it comes from things that are not Multi-Manager:
- the skill list: about 9.5k tokens, of which about 60% is third-party skill plugins (orchestrator-supaconductor, render and others)
- deferred tool names: about 5.6k tokens
- 7 user-level tool connections and about 20 claude.ai connectors
- agent lists
- server instructions

Each session also starts its own roster server process (12 or more are running at once).

After this task, launched architects, project managers and developers start with only what Multi-Manager work needs. The exact keep-list is in the user's sign-off answer. The default is:
- keep: the Multi-Manager plugin, its roster tool connection, the Chrome browser tools, second-opinion, code-review-graph
- drop: other plugins' skills, and claude.ai connectors

The user's own normal Claude Code sessions are unchanged. Nothing is changed in the user's global settings: the launch passes its own settings and tool-connection list (`src/launch/command.ts`, which already passes `--settings` and `--mcp-config`).

## Tests first
- `claudeArgs` for an architect or developer includes the flags or settings that limit plugins and tool connections to the keep-list. Front-desk launches are unchanged unless the sign-off says otherwise.
- The generated settings file disables the plugins not on the keep-list and keeps the Multi-Manager plugin.

## Files expected to change
- `src/launch/command.ts`
- `src/launch/launcher.ts`
- `src/launch/terminal-profile.ts`, only if needed
- tests

NOTE: `src/launch/launcher.ts` and `test/launcher.test.ts` currently have uncommitted edits in the project folder that belong to someone else. Start only after those are committed or settled.

First, check which Claude Code launch options can limit plugins and claude.ai connectors for one session (for example `--strict-mcp-config`, or per-session `enabledPlugins` in the `--settings` file). Report what works before building.

## Out of scope
- The user's global settings files.
- The "Other active sessions" prompt line. That comes from the user's own claude-context-sync tool, not Multi-Manager.

## Test scope
`node --test test/command.test.ts test/launcher.test.ts test/launch-model.test.ts`, then `npm run typecheck` and `npm run lint`. Never run the full suite.

## Evidence required
- Test summary lines.
- A real launched architect in a throwaway project: its first-turn context size before and after (from the transcript), and confirmation that roster tools and Chrome tools still work.
