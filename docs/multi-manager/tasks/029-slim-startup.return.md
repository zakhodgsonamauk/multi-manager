# 029 return: skills on demand through a middle-man

Branch: `worktree-mm-multi-manager-usage-efficiency-dev-029-skill-broker`. Status: done, one gap (see Gaps).

## What changed
- New `src/roster/skill-broker.ts`, registered in `src/roster/tools.ts`: two roster tools.
  - `find_skill(query)`: searches an index of every installed plugin's `skills/*/SKILL.md` and `commands/*.md` (name, plugin, description); returns the best 5. Index is cached and rebuilt when a plugin's skills/commands folders or SKILL.md times change.
  - `load_skill(name, args?)`: returns the instructions with `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}`, `$ARGUMENTS`, `$ARGUMENTS[n]`, `$n` substituted; lists supporting files by absolute path; marks `!` shell lines (inline and fenced) as commands NOT run. Unknown name: "not found. Did you mean: ...".
- `src/launch/command.ts`: `LaunchSpec.disabledPlugins`, `KEEP_PLUGINS` (multi-manager, claude-in-chrome, second-opinion, code-review-graph), `pluginsToDisable()`, `settingsContent()`. When `disabledPlugins` is set, the per-session settings file gets `enabledPlugins: {key: false}` and `disableClaudeAiConnectors: true`. Unset (front desk) leaves settings as before.
- `src/launch/launcher.ts` + `runner.ts`: architects, project managers and developers get the list from the installed-plugins file (new optional `deps.installedPluginKeys`).
- One line in the architect, project-manager and developer briefings naming `find_skill` / `load_skill`.
- Nothing written to the user's global settings.

## Tests (run in my copy)
`node --test test/command.test.ts test/launcher.test.ts test/briefings.test.ts test/skill-broker.test.ts test/server.test.ts`
```
ℹ tests 65
ℹ pass 65
ℹ fail 0
```
`npm run typecheck`: no errors. `npm run lint`: no errors.
New tests (`test/skill-broker.test.ts`, 6): find by "deploy" returns render-deploy with plugin; rebuild picks up a new skill; load substitutes root/args, lists supporting file, marks shell lines; unknown name suggests; settings contain false for all but keep-list plus connectors off; front-desk settings unchanged (only `env`). Added a briefings test and the two new names in `test/server.test.ts`'s tool list.

## Real-run evidence
I did not open a Windows Terminal tab. I ran the real `claude -p` (haiku) from an empty throwaway folder, with this branch as `--plugin-dir`, the architect briefing, and the generated settings files (full = old settings, slim = new). All processes exited; none left running.
- First-turn input size: full 48,411 tokens; slim 36,545 (12,686 new + 23,859 cached). About 12k less (-25%).
- Skill listing: full "149 skills", orchestrator-supaconductor and render both present. Slim "41 skills", none from supaconductor or render. (The remaining 41 come from sources the plugin switch does not control, e.g. built-in and anthropic-skills.)
- `find_skill "render deploy"` returned `render:deploy-to-render`, `render:render-deploy`, `render:render-cli`, `render:render-debug`, `render:render-disks`. `load_skill render:render-deploy` returned `# render:render-deploy (skill) — follow the instructions below`, plugin folder path, then the body.
- Roster tool `list_projects` worked in the slim session.
- Chrome tools: present in both full and slim when claude runs with `--chrome` ("mcp__claude-in-chrome__* tools exist, five loaded"). Without `--chrome` (my first try) none were present in headless mode, so that is a mode effect, not caused by the switch-off.

## Decisions
- 2026-11-24: Keep-list matched on the name before `@`, so it holds whatever marketplace. second-opinion and code-review-graph are tool connections rather than installed plugins here, so they are untouched either way.
- 2026-11-24: Index reads `installed_plugins.json` install paths only (the cache); did not scan marketplace folders, since those hold uninstalled copies.
- 2026-11-24: Did not set `skillListingMaxDescChars` / `skillListingBudgetFraction`: I could not confirm names or defaults, and with other plugins off the list is already small.
- 2026-11-24: plugins synced from claude.ai (`@synced`) are not in the installed file, so are not listed off; `disableClaudeAiConnectors` covers connectors.

## Gaps
- No full architect tab launched via the roster (the running roster uses the main plugin copy, not this branch). The headless runs above use the same settings and plugin code.
- Skill-listing cap settings not set (unverified names).
- Plugin MCP servers/agent types of switched-off plugins are gone from the tab (agent types included); task 031 covers MCP.
- `command.ts` also touched by task 027: small merge conflict possible.

## Send-back round 1 (2026-11-24): fixed
1. Keep-list now also holds `session-voice`, `cc-sounds`, `claudish-to-english` (`src/launch/command.ts`).
2. `load_skill` substitution is one regex pass with function replacers (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}`, `$ARGUMENTS`, `$ARGUMENTS[n]`, `$n`): nothing inserted is re-expanded; `$0` works; an index with no matching argument stays as written; `\$` gives a literal `$`; with args but no consumed placeholder, `ARGUMENTS: <args>` is appended. Numbering: 0-based, per the Claude Code skills docs (`$0` first argument; fetched 2026-11-24, but the argument section was past the page-fetch cutoff, so it comes from a model summary of the page, not verbatim text: worth a glance).
3. `installedPluginFolders` guards every level of the parsed shape and never throws (missing, malformed, `null`, `[]`, wrong shapes all give no plugins).
4. Index signature now includes command-file times; tool descriptions no longer claim "this tab"; supporting-file walk capped at depth 3 and 100 files.

Tests added (all in `test/skill-broker.test.ts` unless noted): `$0`, unmatched `$N`, `$`/`$&` in args, args with no placeholder, root with `$`, missing/malformed/null plugins file, edited command file, file cap, voice/sounds/claudish kept; `test/launcher.test.ts`: architect, project manager and developer get `disabledPlugins` (front desk launch writes no such settings; it has its own path).

`node --test test/command.test.ts test/launcher.test.ts test/briefings.test.ts test/skill-broker.test.ts test/server.test.ts`:
```
ℹ tests 75
ℹ pass 75
ℹ fail 0
```
`npm run typecheck` and `npm run lint`: no errors. No `claude -p` runs this round. Real-tab evidence left to the architect after merge, as agreed. The earlier headless numbers (48.4k to 36.5k) were taken before the keep-list grew, so the saving is now a little smaller.
