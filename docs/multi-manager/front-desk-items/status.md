# Status — workstream `front-desk-items` (goal #124)

## In flight
- End-to-end test on a throwaway test front desk (own empty roster).

## Queued (in order)
- (none)

## Merged
- 020 item categories, auto-clear, status split, front_desk_digest, clear_items, /multi-manager:clear: commit 0ceeb62 (one send-back round). Focused tests on merged main 50/50, typecheck and lint clean. Pushed. Live only after the front desk's roster server restarts (except commands/clear.md, live now; it says so if the tool is missing).
- 021 side panel: two sections, Clear / Clear all, recently answered, front desk told of pane answers, watcher nudge: commit fe9da6e (one send-back round). On merged main: test:mod 47/47, lint clean; typecheck:mod 3 errors, all pre-existing on main (BAND tests, newer API types). Pushed. Live after a plugin reload in the front desk.
- 022 quiet check-ins: the pane drops a scheduled front desk tick when front_desk_digest says nothing new (4 s limit, any error lets it through): commit 0422b00 (one send-back round). On merged main: test:mod 64/64, briefings 11/11, lint clean, typecheck:mod 3 pre-existing errors. Pushed. tick.md front desk section is live now (falls back to team_health + status on the old roster server); the pane part needs the plugin reload.
- Follow-up fix d42d331: commands/clear.md wording (briefings test).

## Going live
- 020 needs the front desk's roster server restarted; 021 and 022 need a plugin reload in the front desk. Both wait for the user's go. 022's tick.md change is live on merge and falls back safely on an old roster server.

## Findings
- Pane answers reach only the raiser (`hooks/register.tsx` answer → `answer_item` → nudge raiser); the front desk model is never told. The front desk tab has no `MM_SESSION_ID`, so the Stop/SessionStart hooks do nothing there.
- The pane drops `watcher_nudge`: a watching project manager is not told when the user answers from the pane.
- No item ever closes itself; answered items stay until closed by hand.

## Next
- Review 020 and 021 returns; then dispatch 022.
