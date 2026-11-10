# Status

Live handover for workstream `pm-handover`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-10 08:50

## Current goal
Roster goal #123: fix the failing check in test/pm-role.test.ts ("restore_all: when the project manager is replaced..."). State: done.
User's go (verbatim, item #1028): "multi-manager: yes, start an architect to fix it." No separate sign-off (decisions.md).
Previous: goal #98 (hand-over in stop_architect), done 2026-11-03.

## In flight
- (none)

## Merged
- Goal #123 test fix (2026-11-10): the restore tests now really use their fake process list. Full npm test 366/366, typecheck and lint clean. Pushed.
- 015 stop_architect hands architects to the real project manager: `d29b606` (2026-11-03, one send-back round for test gaps). Focused tests on merged main 73/73, typecheck and lint clean. Pushed.

## Queued (in order)
- (none)

## Findings
- Goal #123 cause: test setup registered the restore tools with a fake process list, then registerRosterTools registered them again with the machine's real one, and the last registration wins. The test passed or failed depending on whether a real Windows process had id 4004. Code was correct; only the tests changed (test/pm-role.test.ts, and the same latent ordering in test/pm-handover.test.ts).
- Going live needs each caller's roster server restarted (front desk restart or /mcp reconnect). A plugin reload is not enough. Not done by me.
- The sidebar's stop button (hooks/register.tsx:214) ignores the hand-over's `next` line, so stopping an old pm from the sidebar moves the architects but nobody is told. Left out of 015 to keep it small; the front desk briefing says to use stop_architect and send the `next` nudges.
- When multi-manager's old pm (#286) is stopped with a real project manager running, this architect (#304) moves under it too.

## Next
- Nothing queued. Waiting for the user.
