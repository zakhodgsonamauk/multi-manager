# Status — workstream `front-desk-items` (goals #124, #127 done; #129 in progress)

## In flight
- Goal #129 (signed off #1055 "yes go"):
  - 024 panel runs check-ins itself: dev #337 (sonnet), tab mm-multi-manager-front-desk-items-dev-024-pane-check-ins, branch worktree-mm-multi-manager-front-desk-items-dev-024-pane-check-ins.
- Goal #127 done; 023 waits for a roster reconnect in the front desk (user's go, item #1051).

## Queued (in order)
- (none)

## Merged
- 020 item categories, auto-clear, status split, front_desk_digest, clear_items, /multi-manager:clear: commit 0ceeb62 (one send-back round). Focused tests on merged main 50/50, typecheck and lint clean. Pushed. Live only after the front desk's roster server restarts (except commands/clear.md, live now; it says so if the tool is missing).
- 021 side panel: two sections, Clear / Clear all, recently answered, front desk told of pane answers, watcher nudge: commit fe9da6e (one send-back round). On merged main: test:mod 47/47, lint clean; typecheck:mod 3 errors, all pre-existing on main (BAND tests, newer API types). Pushed. Live after a plugin reload in the front desk.
- 022 quiet check-ins: the pane drops a scheduled front desk tick when front_desk_digest says nothing new (4 s limit, any error lets it through): commit 0422b00 (one send-back round). On merged main: test:mod 64/64, briefings 11/11, lint clean, typecheck:mod 3 pre-existing errors. Pushed. tick.md front desk section is live now (falls back to team_health + status on the old roster server); the pane part needs the plugin reload.
- Follow-ups: d42d331 commands/clear.md wording (briefings test); tick.md `paused` backticks (plugin-manifest test, reported by PM); 965e0fe dropped check-in reason reads "Multi-Manager check-in, all quiet".

- 023 front desk recognised again after a roster server restart (goal #127): commit ac857c1 (no send-back). Focused tests on merged main 60/60, typecheck and lint clean. Pushed. Live after the next roster reconnect in the front desk.

- 025 digest skips items already seen; front desk told to mark_seen after showing items (goal #129): commit e91e25c (no send-back). Focused tests on merged main 29/29, typecheck and lint clean. Pushed. tick.md part live now; digest part live after the next roster reconnect in the front desk.

## Going live
- 020 needs the front desk's roster server restarted; 021 and 022 need a plugin reload in the front desk. Both wait for the user's go. 022's tick.md change is live on merge and falls back safely on an old roster server.

## End-to-end test (2026-11-10, throwaway test front desk on its own empty roster, closed by pid)
- Quiet check-ins: dropped before the model runs (no tool blocks, no reply). The engine still prints 2 lines per drop: "Running scheduled task (time)" and "Prompt dropped by a hook: <reason>". No hook found that hides them.
- A check-in with new notes went through with the digest; the next one (nothing new) was dropped.
- Auto-clear closed the 25 h old note within a minute; 30 min and 2 h old notes kept.
- /multi-manager:clear 60: closed the 2 h old done report, kept the 31 min note and both decisions.
- Panel: "Needs your action" on top with Send/Close; "For information" one line each with Clear and Clear all.
- Not tested live: answering from the panel (needs a click in the panel); covered by mod tests only.

## Live check of goal #124 in the real front desk (2026-11-10, screenshots only)
- Panel shows the new layout ("Nothing waiting." when empty).
- User cleared #1047 from the panel: dim line "Cleared #1047 from the panel." in the chat, and the front desk then said "I was told you cleared #1047 from it" (the note reached the model).
- 09:45 scheduled check-in dropped: only "Running scheduled task" and "Prompt dropped by a hook: Multi-Manager check-in, all quiet"; band "Last check 09:45 — all quiet".
- Not yet seen live: a panel *answer* (only a clear so far).

## Findings
- Residual: each quiet check-in still leaves 2 short engine lines in the front desk chat. Removing them needs the pane to start check-ins itself instead of the 10-minute timer (possible follow-up, not started).
- Pane answers reach only the raiser (`hooks/register.tsx` answer → `answer_item` → nudge raiser); the front desk model is never told. The front desk tab has no `MM_SESSION_ID`, so the Stop/SessionStart hooks do nothing there.
- The pane drops `watcher_nudge`: a watching project manager is not told when the user answers from the pane.
- No item ever closes itself; answered items stay until closed by hand.

## Next
- Going live waits for the user's go: front desk roster server restart (020) and plugin reload (021, 022).
- Optional follow-up on the user's go: pane-driven check-ins, so quiet ones leave no lines at all.
