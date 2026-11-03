# graph-watcher decisions

- 2026-11-03 (goal #102) Watch list cut to the two kept projects, not just the stale entries. Context: with the watcher off it is unused, and part 2 wants each project's list kept to its own folders. Alternative: drop only the 4 stale entries; rejected as it leaves 15 folders nobody uses.
- 2026-11-03 (goal #102) Tool connection added per project with `claude mcp ... -s local` (stored in ~/.claude.json), not a `.mcp.json` file in each repo. Context: no files inside financial-portal may be touched without the PM's go, and a repo file would need commits in two other projects. Cost: task copies of those projects don't get the tool (one use in six weeks).
- 2026-11-03 (goal #102) Indexes deleted: untouched for 14+ days, plus the bdn-tolerance side copy. Recent indexes of live projects kept (about 0.9 GB) so part 2 doesn't begin with rebuilds. Alternative: delete everything except the two kept projects; deferred to part 2.
- 2026-11-03 (goal #102) financial-portal index copied with SQLite's online backup from a read-only connection, rather than moving files. Context: its running tabs may hold the file open; a copy cannot break them, a move could. Old copy stays until those tabs restart.
- 2026-11-03 (goal #102) Auto-build turned off with a flag in project-setup.mjs rather than deleting the code, so undo is one word.
