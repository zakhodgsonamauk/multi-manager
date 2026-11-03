# graph-watcher status

Updated: 2026-11-03 14:01. Architect: roster session #310. Goal #102. Plan signed off (item #947, "go").

## In flight
- 018 watcher runs with the team, stale data cleared: developer #315 (tab mm-multi-manager-graph-watcher-dev-018-code-graph-watcher, branch worktree-mm-multi-manager-graph-watcher-dev-018-code-graph-watcher, Sonnet), dispatched 14:01.

## Queued
1. Architect's end-to-end check in a throwaway project, switch financial-portal on, report done.

## Merged
- 017 developer copies get the tool: `02412ec` (2026-11-03, 1 send-back round).
- 016 per-project switch + set_code_graph: `2731543` (2026-11-03, 1 send-back round).
- 019 project manager instructions: `6ec7aa1` (2026-11-03).

## Done
- Part 1 (options B + C from report.md), 2026-11-03: code-review-graph is on-demand. Details, evidence and undo: changes.md.
- Follow-ups (item #944): financial-portal old index deleted; tell-me-a-story index moved out of Dropbox.

## Still open
- Open tabs keep their tool connection until restarted (30 programs, 5.7 GB at 13:26).
- Running project managers get set_code_graph only after a restart (user's go).

## Findings (record-only)
- The fork's `daemon stop` on Windows ends only the control process; its 54 folder watchers kept running and had to be closed one by one. Upstream bug in the user's fork (C:\Users\zak_h\dev\code-review-graph).
