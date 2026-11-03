# Status

Live handover for workstream `pm-handover`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-03 13:05

## Current goal
Roster goal #98: stopping an old "pm" architect hands its running architects to the project's real project manager. State: in-progress.
Plan and testing approach: covered by the user's go on item #919 ("sure, go on the follow-up"); no separate sign-off (decisions.md).

## In flight
- 015 stop_architect hands architects to the real project manager: dev session #306, tab `mm-multi-manager-pm-handover-dev-015-pm-handover`, branch `worktree-mm-multi-manager-pm-handover-dev-015-pm-handover`, round 1 (send-back: 3 test gaps).

## Merged
- (none)

## Queued (in order)
- (none)

## Findings
- Going live needs each caller's roster server restarted (front desk restart or /mcp reconnect). A plugin reload is not enough. Not done by me.

## Next
- Review 015 when it returns.
- The sidebar's stop button (hooks/register.tsx:214) ignores the hand-over's `next` line, so stopping an old pm from the sidebar moves the architects but nobody is told. Left out of 015 to keep it small; the front desk briefing says to use stop_architect and send the `next` nudges.
