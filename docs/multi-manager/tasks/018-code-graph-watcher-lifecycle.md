# 018 — code-review-graph watcher runs only while its team does; stale data cleared on architect stop

Goal #102. Needs 016 and 017 merged: it edits the same launch and stop code as 017. Branch: `worktree-mm-multi-manager-graph-watcher-dev-018-code-graph-watcher`. Return report: `docs/multi-manager/tasks/018-code-graph-watcher-lifecycle.return.md` on that branch.

## Goal
For a project with `code_graph` on, its folder watcher keeps the index fresh while an architect or project manager of that project is running, and stops when the last one stops. When no project needs a watcher, the background watcher program is shut down.

When an architect stops, the tool's stale data is cleared:
- entries in its folder list (`~/.code-review-graph/registry.json`) whose folders no longer exist are removed;
- their index folders are deleted, but only folders under `%LOCALAPPDATA%\code-review-graph\graphs\`.

Background: part 1 found that `code-review-graph daemon stop` on Windows ends only the control program, and its folder watchers keep running. So after stopping it, any program whose command line is `code-review-graph ... watch --repo <folder>` is closed by its own process id. Never by window title or by name.

## Tests first
In `test/codegraph.test.ts`, with the fake runner and a fake process list:
- `ensureWatcher(project)`:
  - runs `daemon add "<folder>"`;
  - runs `daemon start`, spawned detached with `windowsHide: true` and not waited on, only if `daemon status` does not report `Daemon: running`.
- `releaseWatcher(project, stillRunning)`:
  - When no other architect or project manager of that project is running, it runs `daemon remove "<folder>"`.
  - When the watch list is then empty, it runs `daemon stop` and closes only the leftover watcher programs, matched by command line, by their process ids.
  - The tool-connection programs (`... serve`) are never closed.
- `pruneStaleGraphData(fs)`, using a temp folder as the data root:
  - Registry entries whose `path` no longer exists are removed.
  - Their `data_dir` is deleted only when it lies inside the data root.
  - A `data_dir` outside the root is left alone, and that is logged.
  - Entries whose folders still exist are kept unchanged.
  - The registry is written atomically (temp file + rename).
- In `test/launcher.test.ts`:
  - Launching an architect or project manager for an "on" project calls `ensureWatcher`.
  - Stopping the last one calls `releaseWatcher`.
  - Stopping an architect calls `pruneStaleGraphData`.
  - For "off" projects none of these run.
  - A failing command is logged and never blocks a launch or stop.

## Files expected to change
- `src/codegraph/codegraph.ts`: `ensureWatcher`, `releaseWatcher`, `pruneStaleGraphData`.
- `src/launch/launcher.ts`: calls on launch and stop.
- `src/launch/process.ts`: only if a process-list helper is needed. Reuse the existing snapshot code.
- The tests above.

## Out of scope
- Building or rebuilding indexes.
- Any change to the code-review-graph fork itself.
- Closing any program not matched as a code-review-graph watcher.
- Running real watcher commands in tests.

## Test scope
`node --test test/codegraph.test.ts test/launcher.test.ts test/process.test.ts` (only those that exist), then typecheck and lint. Never the full suite.

## Evidence required
Focused test summary lines, typecheck and lint output.
