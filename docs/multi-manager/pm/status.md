# Project manager status (multi-manager)

Updated: 2026-11-10 08:31

Project manager: roster session #327, goal #81, workstream `pm`.

## Architects
- #328 pm-handover, goal #123: fix failing crash-restore test (test/pm-role.test.ts, restore_all with replaced project manager).
- #329 front-desk-items, goal #124 (front desk pointer #122): front-desk items UI, categories, auto-clearing, pane replies reaching the front desk, quieter ticks. Plan sign-off expected.

## Goals
- #99 / #100 code-review-graph investigation: done.
- #101 / #102 code-review-graph B + C and per-project switch: done.
- #123 test fix: in progress.
- #122 / #124 front-desk items: in progress.

## Overlaps
- #328 and #329 may both touch the roster server tool code. Order: #328 is small, likely merges first; #329 pulls in latest main before each merge.
- #329 changes front desk and tick skills, live on merge. Any roster server / plugin / tab restart needs the user's go.

## Next
- Parked for the user's go: switch financial-portal's code-review-graph on.
