# graph-watcher status

Updated: 2026-11-03 13:35. Architect: roster session #310. Goal #102.

## In flight
- Part 2 plan awaiting the user's sign-off (via the front desk). Plan: pm-ownership-plan.md. Nothing for part 2 is built before the answer.

## Queued (in order, after sign-off)
1. 016 per-project switch + set_code_graph command (tasks/016-code-graph-switch.md)
2. 017 developer copies get the tool (tasks/017-code-graph-dev-copies.md)
3. 019 project manager instructions (tasks/019-code-graph-pm-briefing.md), alongside 017
4. 018 watcher runs with the team, stale data cleared (tasks/018-code-graph-watcher-lifecycle.md), after 017

## Done
- Part 1 (options B + C from report.md), 2026-11-03: code-review-graph is on-demand. Details, evidence and undo: changes.md.

## Follow-ups (need a go)
- (done 13:30) financial-portal old index deleted; tell-me-a-story index moved out of Dropbox (item #944).
- Open tabs keep their tool connection until restarted (30 programs, 5.7 GB at 13:26).

## Findings (record-only)
- The fork's `daemon stop` on Windows ends only the control process; its 54 folder watchers kept running and had to be closed one by one. Upstream bug in the user's fork (C:\Users\zak_h\dev\code-review-graph).
