# Status — workstream `pane-status` (goal #85)

## In flight
- (none)

## Merged
- 009 sidebar survives odd roster answers; status answers stay small: commit 1612de5 (one send-back round). Focused tests on merged code: status 10/10, sidebar 31/31, typecheck and lint clean.

## Queued
- (none)

## Findings
- Pane crash: `rosterJson` returns raw text for a non-JSON answer; `buildView` then reads `waiting_for_user` off a string. Likely trigger: a too-big `status` answer replaced by Claude Code's "exceeds maximum allowed tokens" note (not proven). Live status answer today 41 KB, mostly full goal texts.

## Next
- Live sidebar check: needs the front desk's sidebar reloaded. Ask the front desk first, then screenshot it.
