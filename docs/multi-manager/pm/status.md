# Project manager status (multi-manager)

Updated: 2026-11-10 12:20

Project manager: roster session #327, goal #81, workstream `pm`.

## Architects
- (none running)

## Goals
- #99 / #100, #101 / #102 code-review-graph: done.
- #123 test fix: done (ef990e6, flaky test).
- #122 / #124 front-desk items: done, switched on 09:38.
- #127 front desk re-registers after roster restart: merged (ac857c1).
- #128 / #129 quiet check-ins leave nothing in chat; digest skips seen items: merged (759d35c, e91e25c). 392/392.
- #127 and #129 wait for one reconnect + plugin reload in the front desk: question #1063 (covers #1051).

## Overlaps
- (none)

## Next
- After the reconnect: confirm the front desk recognised itself without start_front_desk, the old timer deleted itself, and quiet check-ins leave nothing. If not, start an architect on front-desk-items.
- Not seen live yet: answering a sign-off/question from the panel; panel's backup path.
- Empty test windows from end-to-end tests: user to close by hand.
- Parked for the user's go: switch financial-portal's code-review-graph on.
