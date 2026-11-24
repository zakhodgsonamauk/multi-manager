# 029 — Plugins through a middle-man: skills on demand

Goal #2. Branch: `worktree-mm-multi-manager-usage-efficiency-dev-029-skill-broker`. Return report: `docs/multi-manager/tasks/029-slim-startup.return.md` on that branch.

## The user's words (sign-off item #2, Q2)
"ideally we'd wrap plugins in some sort of middle-man so they're still available, but only stuck into context when relevant."

## Goal
Every Multi-Manager session starts with about 65-70k tokens of fixed text, and that text is re-read on every model call for the whole life of the session. Most of it comes from other plugins, not Multi-Manager:
- The skill list is about 9.5k tokens. About 60% of it is third-party plugins such as orchestrator-supaconductor and render.
- Those plugins' agent types add to the agent list.
- The claude.ai connectors add about 20 entries.

After this task, Multi-Manager tabs (architects, project managers, developers) start with those other plugins and the connectors switched off for that session only. Their skills stay available through a middle-man: two new roster tools.
- `find_skill(query)` searches an index of every installed plugin's skills and commands (name, plugin, one-line description) and returns the best few matches.
- `load_skill(name, args?)` returns that skill's instructions, ready to follow.

A one-line note in each briefing tells the model the middle-man exists. The user's own normal Claude Code sessions do not change, and nothing is written to the user's global settings.

## Documented levers (researched 2026-11-24 from the Claude Code docs; verify each in a real launch)
- `enabledPlugins` in the per-session `--settings` file. It outranks user settings and applies to that session only. Use `"name@marketplace": false`, and `"name@synced": false` for plugins synced from claude.ai. The docs give no "all except" form, so build the false-list from `claude plugin list --json` (or the installed plugins file) at launch time. Multi-Manager itself loads through `--plugin-dir` (it shows as `@inline`), so it stays on.
- `"disableClaudeAiConnectors": true` in the same settings file, or the environment variable `ENABLE_CLAUDEAI_MCP_SERVERS=false`. This removes the claude.ai connectors.
- `skillListingMaxDescChars` and `skillListingBudgetFraction` cap the skill list that is left. Set them modestly, so Multi-Manager's own skills stay fully described. Check their names and defaults before relying on them.

## The middle-man's job
- Index: scan the installed plugins' folders (under `~/.claude/plugins/`, the cache and the marketplaces) for `skills/*/SKILL.md` and `commands/*.md`, and read their frontmatter. Cache the index and rebuild it when the plugin folders change.
- `load_skill`: return the body with the work the Claude Code harness would normally do already done:
  - substitute `${CLAUDE_PLUGIN_ROOT}` with that plugin's folder;
  - substitute arguments (`$ARGUMENTS`, `$1`...);
  - list any supporting files in the skill folder by absolute path, so the model can Read them;
  - for inline shell blocks (`!` lines), do not run them. Return them clearly marked as commands the model can run itself.
- Keep the two tools' descriptions short. They are always in context.
- Out of scope here: wrapping other plugins' MCP servers and agent types. MCP tools are already loaded lazily by Claude Code (only their names show). Task 031 handles MCP servers.

## Keep-list (default, from the plan)
Always kept on:
- the Multi-Manager plugin;
- the Chrome browser tools (needed for click-through tests);
- second-opinion;
- code-review-graph.

Every other plugin is off in the tab and reachable through `find_skill` / `load_skill`.

## Tests first
- `claudeArgs` / the generated per-session settings for an architect or developer contain `enabledPlugins` false for every installed plugin except the keep-list, plus `disableClaudeAiConnectors: true`. The front desk is unchanged.
- The index: given a fake plugins folder with two plugins (one skill, one command each), `find_skill("deploy")` returns the matching one with its plugin name. A rebuild picks up a newly added skill.
- `load_skill` substitutes `${CLAUDE_PLUGIN_ROOT}` and `$ARGUMENTS`, lists supporting files by absolute path, and marks `!` shell lines without running them. An unknown name gives a clear "not found, did you mean" answer.
- Briefings test: each role's briefing mentions `find_skill`.

## Files expected to change
- `src/launch/command.ts`
- the settings-file writer (find where `settingsPath` is made)
- a new `src/roster/skill-broker.ts` (index and load), registered in `src/roster/tools.ts`
- the briefings (one line each)
- tests

The unsaved edits that used to be in these files were committed as `528e3d7`. Task 027 (in flight) also edits `src/launch/command.ts`: it adds an environment variable for managers. Keep your change in `command.ts` to the arguments and settings, and expect the architect to settle any small conflict at merge.

## Out of scope
- The user's global settings.
- MCP servers (task 031).
- The "Other active sessions" line (left as it is; the user's agreed default).
- Editing other plugins' files.

## Test scope
`node --test test/command.test.ts test/launcher.test.ts test/briefings.test.ts` plus the new skill-broker tests, then `npm run typecheck` and `npm run lint`. Never run the full suite.

## Evidence required
- Test summary lines.
- A real launched architect in a throwaway project (ask the architect before opening test tabs). Show:
  - its first-turn context size before and after, from the transcript;
  - that the supaconductor and render skills are gone from its listing;
  - that `find_skill` then `load_skill` returns a usable render skill;
  - that the roster tools and Chrome tools still work.

## Send-back round 1 (2026-11-24)
From the outside review. The keep-list safety, the unchanged front desk, the no-execution rule and the no-traversal check all passed. Fix these:

1. **Voice and other hook plugins break in tabs** (`src/launch/command.ts:51`). `session-voice` is switched off, so `set_voice` and `voice_status` stop working in tabs. Add `session-voice`, `cc-sounds` and `claudish-to-english` to the keep-list. They are hook plugins the user relies on, not skill bulk. Architect's decision, logged.
2. **`load_skill` argument substitution is wrong** (`src/roster/skill-broker.ts:180-184`):
   - Use one pass, with a single regex and function replacers, so `$`, `$&` or `$1` inside the args are never re-expanded.
   - `$0` must not be erased.
   - Leave any `$N` with no matching argument as it is, so awk's `$1` and regex back-references survive.
   - Match Claude Code's current numbering for `$ARGUMENTS[n]` and `$n`. Check the skills docs and note which one you used.
   - When the body has no `$ARGUMENTS` placeholder and args were given, add `ARGUMENTS: <args>` at the end, as the harness does.
   - Use function replacers for `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` too.
3. **A bad plugins file fails the launch** (`src/roster/skill-broker.ts:92`). A file containing just `null` makes `parsed.plugins` throw outside the try, and the error reaches `launchTab`. Guard the parsed shape. A launch must never fail because of this file.
4. **Smaller fixes:**
   - Pick up edits to command files when rebuilding the index.
   - Make the tool descriptions true in the front desk too (do not say "switched off in this tab").
   - Bound the supporting-file walk: a depth or count cap.

Missing tests to add:
- `$0`
- an unmatched `$N`
- `$` and `$&` inside args
- args when the body has no placeholder
- `installedPluginFolders` with a missing file, a malformed file, and a `null` file
- the launcher passing `disabledPlugins` for architect, project manager and developer, and not for the front desk
- the voice, sounds and claudish plugins staying on

Rules:
- No more headless `claude -p` runs: interactive tabs only.
- The real-tab evidence is no longer required from you. The architect will check it in a launched tab after merge.

Update the return report, then raise `done` again.
