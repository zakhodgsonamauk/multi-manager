# graph-watcher status

Updated: 2026-11-03 14:15. Architect: roster session #310. Goal #102: done. Plan signed off (item #947, "go").

## In flight
- (none)

## Merged
- 016 per-project switch + set_code_graph: `2731543` (2026-11-03, 1 send-back round).
- 019 project manager instructions: `6ec7aa1` (2026-11-03).
- 017 developer copies get the tool: `02412ec` (2026-11-03, 1 send-back round).
- 018 watcher runs with the team, stale data cleared: `e114138` (2026-11-03, 1 send-back round).

## Done
- Part 1 (options B + C from report.md), 2026-11-03: code-review-graph is on-demand. Details, evidence and undo: changes.md.
- Follow-ups (item #944): financial-portal old index deleted; tell-me-a-story index moved out of Dropbox.
- End-to-end check (architect, 14:10), 20/20 pass. Output: C:\Users\zak_h\AppData\Local\Temp\claude\228ed30c5bfbdf97\e3f906a4-bdac-4fd0-acce-721e855bfab4\scratchpad\e2e\e2e-output.txt.

## Paused / parked
- Switching financial-portal on (`set_code_graph financial-portal true`). Its tool connection and watch-list entry are already in place from part 1; only the roster switch is still off. Every running front desk and project manager loaded its roster tools before 016, so none of them has `set_code_graph` until it restarts, and restarts wait for the user's go. Until then financial-portal behaves as it does today: the tool works in its main folder, its developers' copies don't get it, and no watcher runs.

## Still open
- Open tabs keep their old tool connection until restarted (30 programs, 5.7 GB at 13:26).

## Next
- On the user's go: restart the front desk or financial-portal's project manager, then `set_code_graph financial-portal true`.

## Findings (record-only)
- The fork's `daemon stop` on Windows ends only the control process; its 54 folder watchers kept running and had to be closed one by one. Upstream bug in the user's fork (C:\Users\zak_h\dev\code-review-graph). Task 018 works around it.
- `daemon add`/`remove` rewrite watch.toml in the tool's own format, dropping the comments left in it by part 1. Harmless.
