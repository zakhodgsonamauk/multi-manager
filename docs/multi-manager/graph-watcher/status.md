# graph-watcher status

Updated: 2026-11-03 13:30. Architect: roster session #310. Goal #102.

## In flight
- Part 2: answer to "can each project's project manager manage code-review-graph?" plus the plan. Plan sign-off goes to the front desk. Nothing for part 2 is built before the user answers.

## Done
- Part 1 (options B + C from report.md), 2026-11-03: code-review-graph is on-demand. Details, evidence and undo: changes.md.

## Follow-ups (need a go)
- (done 13:30) financial-portal old index deleted; tell-me-a-story index moved out of Dropbox (item #944).
- Open tabs keep their tool connection until restarted (30 programs, 5.7 GB at 13:26).

## Findings (record-only)
- The fork's `daemon stop` on Windows ends only the control process; its 54 folder watchers kept running and had to be closed one by one. Upstream bug in the user's fork (C:\Users\zak_h\dev\code-review-graph).
