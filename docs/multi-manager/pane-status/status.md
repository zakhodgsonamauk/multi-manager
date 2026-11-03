# Status — workstream `pane-status` (goal #85)

## In flight
- (none)

## Merged
- 009 sidebar survives odd roster answers; status answers stay small: commit 1612de5 (one send-back round). Focused tests on merged code: status 10/10, sidebar 31/31, typecheck and lint clean.

## Queued
- (none)

## Findings
- Pane crash: `rosterJson` returns raw text for a non-JSON answer; `buildView` then reads `waiting_for_user` off a string. Likely trigger: a too-big `status` answer replaced by Claude Code's "exceeds maximum allowed tokens" note (not proven). Live status answer today 41 KB, mostly full goal texts.

## Live check
- 2026-11-03 12:40 after the user's plugin reload: screenshot `docs/multi-manager/tasks/009-shots/live-sidebar-after-reload.png`. Sidebar draws the waiting item and the projects tree; no "roster unavailable", no "did not load" note. Status answer on a copy of today's roster: 17,586 characters (was 41,331 this morning with fewer goals).

## Next
- Goal #85 done. Nothing queued.
