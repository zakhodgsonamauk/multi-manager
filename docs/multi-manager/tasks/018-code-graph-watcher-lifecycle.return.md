# 018 — return report (round 1)

Branch: `worktree-mm-multi-manager-graph-watcher-dev-018-code-graph-watcher`.

## What changed
- `src/codegraph/codegraph.ts`: `ensureWatcher` (adds the folder; starts `daemon start` detached, hidden, never awaited, only if `daemon status` lacks `Daemon: running`), `releaseWatcher` (when no other architect/project manager of the project runs: `daemon remove`; if the watch list is then empty: `daemon stop`, then closes leftover `watch --repo` programs by process id only), `pruneStaleGraphData` (drops registry entries whose folder is gone; deletes their index folder only strictly inside the data root; atomic temp+rename write; outside folders left alone and logged).
- `src/launch/launcher.ts`: launching an architect or project manager of an "on" project calls `ensureWatcher`; stopping one calls `releaseWatcher`, and stopping an architect also calls `pruneStaleGraphData`. Failures are logged, never block.
- `src/launch/runner.ts`: optional `codeGraph` dependency, wired in `realDeps`. `src/launch/process.ts`: `parseProcessList`.
- Tests: new `test/codegraph-watcher.test.ts`; four new tests in `test/launcher.test.ts` (on/off, last-stop, failure).

## Tests run
`node --test test/codegraph-watcher.test.ts test/codegraph.test.ts test/launcher.test.ts test/process.test.ts`
```
ℹ tests 53
ℹ pass 53
ℹ fail 0
```
`npm run typecheck` and `npm run lint`: no output after the command echo (clean).

## Screenshots
None (no UI).

## Decisions made
See `docs/multi-manager/decisions.md`, entry "Task 018".

## Gaps
- Real `daemon start`, process listing and `taskkill` are not run in tests (out of scope); only fakes. The `daemon status` text format (`Daemon:  running`, rows under the `----  ----` rule) was checked against the installed tool's actual output.
- `codegraph.ts` and `runner.ts` now import each other (functions only used at call time, tests and typecheck pass).

## Round 2 (send-back round 1 fixed)
- `pruneStaleGraphData` now treats an entry as stale only when its folder is missing AND its parent folder exists (for a worktree copy the parent is the `.claude\worktrees` or `.worktrees` folder). If the parent is missing too (offline or unmounted drive), the entry is kept, its index is not deleted, and a line is logged.
- New test: folder and parent both missing → registry byte-identical, index kept, one log line. The existing "missing folder, parent present → pruned" test still covers the other case.
- `node --test test/codegraph-watcher.test.ts test/codegraph.test.ts test/launcher.test.ts test/process.test.ts`: `ℹ tests 54`, `ℹ pass 54`, `ℹ fail 0`. Typecheck and lint clean.
