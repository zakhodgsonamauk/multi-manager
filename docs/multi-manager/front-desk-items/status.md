# Status — workstream `front-desk-items` (goal #124)

## In flight
- 021: dev #332, tab mm-multi-manager-front-desk-items-dev-021-pane-items-ui, branch worktree-mm-multi-manager-front-desk-items-dev-021-pane-items-ui (sonnet, complexity 3, clarity 4). Send-back round 1.

## Queued (in order)
1. 022 Quiet front desk check-in: the pane drops check-ins with nothing new; tick.md uses the digest. After 020 and 021.

## Merged
- 020 item categories, auto-clear, status split, front_desk_digest, clear_items, /multi-manager:clear: commit 0ceeb62 (one send-back round). Focused tests on merged main 50/50, typecheck and lint clean. Pushed. Live only after the front desk's roster server restarts (except commands/clear.md, live now; it says so if the tool is missing).

## Going live
- 020 needs the front desk's roster server restarted; 021 and 022 need a plugin reload in the front desk. Both wait for the user's go. 022's tick.md change is live on merge and falls back safely on an old roster server.

## Findings
- Pane answers reach only the raiser (`hooks/register.tsx` answer → `answer_item` → nudge raiser); the front desk model is never told. The front desk tab has no `MM_SESSION_ID`, so the Stop/SessionStart hooks do nothing there.
- The pane drops `watcher_nudge`: a watching project manager is not told when the user answers from the pane.
- No item ever closes itself; answered items stay until closed by hand.

## Next
- Review 020 and 021 returns; then dispatch 022.
