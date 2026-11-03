# Status — workstream `pane-status` (goal #97)

## In flight
- (none)

## Merged
- 009 sidebar survives odd roster answers; status answers stay small: commit 1612de5 (goal #85).
- 014 start_front_desk answer compact, waiting items listed once, project item texts cut at 120: commit 8220c3b (goal #97, one send-back round). Focused tests on merged main: status + start text 10/10, sidebar 33/33, typecheck and lint clean. Pushed.

## Sizes (characters)
- Front desk measured live start_front_desk: 54,111 (its roster server predates 1612de5).
- Copy of today's roster, merged code: start_front_desk 19,087 (status part 12,406). Stress test (3 projects, 20 goals, 25 items, 5,000 chars each): 23,938, under the 25,000 target.

## Findings
- The front desk's roster server (pid 20960, started 09:27) and the 09:34 project manager servers run code from before today's merges. A plugin reload did not restart them. Going live needs the roster server restarted (front desk restart or /mcp reconnect). Not done by me.

## Next
- After the front desk's roster server restarts: front desk re-measures start_front_desk; screenshot check of the sidebar.
