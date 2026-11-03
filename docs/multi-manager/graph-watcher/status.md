# graph-watcher status

Updated: 2026-11-03 13:57. Architect: roster session #310. Goal #102. Plan signed off (item #947, "go").

## In flight
- 017 developer copies get the tool: developer #313 (tab mm-multi-manager-graph-watcher-dev-017-code-graph-dev-copies, branch worktree-mm-multi-manager-graph-watcher-dev-017-code-graph-dev-copies, Sonnet), dispatched 13:56.
- 019 project manager instructions: developer #314 (tab mm-multi-manager-graph-watcher-dev-019-code-graph-pm-briefing, branch worktree-mm-multi-manager-graph-watcher-dev-019-code-graph-pm-briefing, Haiku), dispatched 13:56.

## Queued
1. 018 watcher runs with the team, stale data cleared (tasks/018-code-graph-watcher-lifecycle.md). Starts after 017 merges (same launch/stop code).
2. Then: architect's end-to-end check in a throwaway project, switch financial-portal on, report done.

## Merged
- 016 per-project switch + set_code_graph: `2731543` (2026-11-03, 1 send-back round).

## Done
- Part 1 (options B + C from report.md), 2026-11-03: code-review-graph is on-demand. Details, evidence and undo: changes.md.
- Follow-ups (item #944): financial-portal old index deleted; tell-me-a-story index moved out of Dropbox.

## Still open
- Open tabs keep their tool connection until restarted (30 programs, 5.7 GB at 13:26).
- Running project managers get set_code_graph only after a restart (user's go).

## Findings (record-only)
- The fork's `daemon stop` on Windows ends only the control process; its 54 folder watchers kept running and had to be closed one by one. Upstream bug in the user's fork (C:\Users\zak_h\dev\code-review-graph).
