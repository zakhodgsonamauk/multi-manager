# Status — workstream `pane-status` (goal #85)

## In flight
- Planning. Sign-off pending.

## Queued
- 009 pane survives odd roster answers; status answers stay small.

## Findings
- Pane crash: `rosterJson` returns raw text for a non-JSON answer; `buildView` then reads `waiting_for_user` off a string. Likely trigger: a too-big `status` answer replaced by Claude Code's "exceeds maximum allowed tokens" note (not proven). Live status answer today 41 KB, mostly full goal texts.

## Next
- Sign-off, then dispatch 009.
