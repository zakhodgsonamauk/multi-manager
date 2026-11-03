# Status

Live handover for workstream `pm-handover`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-03 13:05

## Current goal
Roster goal #98: stopping an old "pm" architect hands its running architects to the project's real project manager. State: done.
Plan and testing approach: covered by the user's go on item #919 ("sure, go on the follow-up"); no separate sign-off (decisions.md).

## In flight
- (none)

## Merged
- 015 stop_architect hands architects to the real project manager: `d29b606` (2026-11-03, one send-back round for test gaps). Focused tests on merged main 73/73, typecheck and lint clean. Pushed.

## Queued (in order)
- (none)

## Findings
- Going live needs each caller's roster server restarted (front desk restart or /mcp reconnect). A plugin reload is not enough. Not done by me.
- The sidebar's stop button (hooks/register.tsx:214) ignores the hand-over's `next` line, so stopping an old pm from the sidebar moves the architects but nobody is told. Left out of 015 to keep it small; the front desk briefing says to use stop_architect and send the `next` nudges.
- When multi-manager's old pm (#286) is stopped with a real project manager running, this architect (#304) moves under it too.

## Next
- Nothing queued. Waiting for the user.
