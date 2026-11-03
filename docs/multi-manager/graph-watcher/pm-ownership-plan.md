# Part 2: each project's project manager owns its code-review-graph

Goal #102. Date: 2026-11-03. This is the answer to the user's question, plus the plan. Nothing here is built until the user signs off.

The user's question (roster item #935): "can we wrap management of code-review-graph per project under the project manager session?"

## Short answer

- **Yes, it's doable.** It needs changes in four places in Multi-Manager:
  - a new per-project switch the project manager controls;
  - giving the tool to developers' temporary copies;
  - starting and stopping the project's watcher with its team;
  - a few lines in the project manager's instructions.
- **Build cost: about $30-45** in four developer tasks, plus reviews. No new programs run in the background between sessions.
- **Running cost** applies only to projects switched on:
  - about 0.57 GB of memory for each open tab in that project, since each tab starts its own copy of the tool;
  - about 0.1 GB for the project's watcher, and only while its team is working.
  - Projects switched off cost nothing.
- **Nothing restarts.** New tabs pick up the change. Running project managers only get the new switch after a restart, and that waits for the user's go.

## What the project manager will be able to do

1. **Decide whether its project uses the tool**, with a new roster command, `set_code_graph` (on or off).
   - Only the front desk, or that project's own running project manager, may change it.
   - "On" adds the tool connection for the project's folder. This uses Claude's own command, local to that folder, as in part 1. It also puts the project on the watch list.
   - "Off" removes both.
   - New projects start off. After the build, financial-portal is switched on, to match today.
2. **Developers' temporary copies get the tool too** when the project is on.
   - The developer's tab is started with its own tool-connection file.
   - That file points the tool at the main project's index, so the developer searches an up-to-date index without building their own.
   - Today they get nothing (follow-up 3 from part 1).
3. **The watcher runs only while the team does.**
   - When the project's first architect or project manager starts, its folder watcher starts.
   - When the last one stops, the watcher stops.
   - When no project needs a watcher, the background watcher program is shut down. Any folder watchers it leaves behind are closed by their own process ids. The tool's own stop command misses those on Windows, as seen in part 1.
4. **Stale data is cleared when architects finish.**
   - When an architect stops, entries in the tool's folder list whose folders no longer exist are removed.
   - Their index folders under the tool's own data folder are deleted.
   - Nothing outside that data folder is ever deleted.
5. **The project manager's instructions** say when to switch the tool on: when the project's architects or developers will search code across a large codebase. Otherwise it stays off.

tell-me-a-story is not a Multi-Manager project, so no project manager manages it. It stays as part 1 left it: the tool is on for sessions opened by hand.

## Tasks (in order)

| # | Task | Why this order |
|---|---|---|
| 016 | The per-project switch and the `set_code_graph` command, plus a small module that adds or removes the tool connection and the watch-list entry | Everything else reads the switch |
| 017 | Developer tabs in "on" projects get a tool-connection file pointing at the main index | Changes how tabs are launched; needs 016 |
| 018 | Watcher starts and stops with the team; stale data cleared when an architect stops | Changes the same launch and stop code as 017, so it runs after 017, never alongside |
| 019 | Project manager instructions and the command list | Can run alongside 017 |

Task files: `docs/multi-manager/tasks/016-code-graph-switch.md`, `017-code-graph-dev-copies.md`, `018-code-graph-watcher-lifecycle.md`, `019-code-graph-pm-briefing.md`.

## Testing approach

- **Unit tests first, in every task.** A fake command runner stands in for `claude mcp` and `code-review-graph`, so tests never touch real settings or start real programs. Only focused test files are run (listed in each task), never the full suite.
- **End-to-end check (the architect, after the merges).**
  - In a throwaway git folder registered as a throwaway roster project, switch it on, then off, with the real commands.
  - Read back `~/.claude.json` and the watch list after each step.
  - Check that the watcher program appears and disappears (hidden, no windows).
  - Check that the generated developer tool-connection file points at the main index.
  - No terminal tabs are opened for this check, since that would put windows on the user's screen.
  - Afterwards the throwaway project, its folder and its entries are removed, and that is checked too.
- **No browser click-through**, because no screen changes: the pane is not touched.

## Restarts and risks

- Merging changes the plugin code that new tabs load. No running tab, roster server or plugin is restarted by this work. The front desk is told before the merge.
- The new switch is stored as a new roster column. It is added automatically the first time a new tab's roster server starts. Older running tabs keep working, because they ignore the extra column.
- Restarting the project managers so they get `set_code_graph` waits for the user's go.
