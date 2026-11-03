# Status — workstream `pane-status` (goal #85)

## In flight
- 009 pane survives odd answers, status answers stay small: dev #291 (tab mm-multi-manager-pane-status-dev-009-pane-odd), sonnet, branch `worktree-mm-multi-manager-pane-status-dev-009-pane-odd`.

## Queued
- (none)

## Findings
- Pane crash: `rosterJson` returns raw text for a non-JSON answer; `buildView` then reads `waiting_for_user` off a string. Likely trigger: a too-big `status` answer replaced by Claude Code's "exceeds maximum allowed tokens" note (not proven). Live status answer today 41 KB, mostly full goal texts.

## Next
- Review 009 on return, merge, push, then live sidebar check (front desk's go before any reload).
- After 009 merges: message mm-multi-manager-pm-role (#292); it waits on those files.
