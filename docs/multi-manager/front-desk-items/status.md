# Status — workstream `front-desk-items` (goal #124)

## In flight
- (none; plan sign-off pending)

## Queued (in order)
1. 020 Item categories, auto-clear, status split, `front_desk_digest` tool (roster server). Parallel with 021.
2. 021 Side panel: "Needs your action" / "For information" sections, Clear / Clear all, recently answered, front desk told of pane answers, watcher nudge fix (pane only). Parallel with 020.
3. 022 Quiet front desk check-in: the pane drops check-ins with nothing new; tick.md uses the digest. After 020 and 021.

## Merged
- (none)

## Going live
- 020 needs the front desk's roster server restarted; 021 and 022 need a plugin reload in the front desk. Both wait for the user's go. 022's tick.md change is live on merge and falls back safely on an old roster server.

## Findings
- Pane answers reach only the raiser (`hooks/register.tsx` answer → `answer_item` → nudge raiser); the front desk model is never told. The front desk tab has no `MM_SESSION_ID`, so the Stop/SessionStart hooks do nothing there.
- The pane drops `watcher_nudge`: a watching project manager is not told when the user answers from the pane.
- No item ever closes itself; answered items stay until closed by hand.

## Next
- Plan sign-off (goal #124).
