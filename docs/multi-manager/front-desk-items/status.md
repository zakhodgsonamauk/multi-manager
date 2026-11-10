# Status — workstream `front-desk-items` (goals #124, #127, #129 done)

## In flight
- (none). Goal #129 done; 024 needs a plugin reload and 025 a roster reconnect in the front desk (user's go, bundle with #1051).
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

- 024 the panel runs the front desk's check-ins itself; model's tick timer refused while the panel's loop is alive (goal #129): commit 759d35c (one send-back round). On merged main: test:mod 76/76, briefings/manifest/hooks 21/21, lint clean, typecheck:mod 3 pre-existing. Pushed. Live after a plugin reload in the front desk; briefing change applies to new front desks now.

## Going live
- Goal #129: plugin reload (024) and roster reconnect (025) in the front desk, one go with #127's reconnect (item #1051). Until then the real front desk keeps the old timer and its 2 lines per quiet check-in.
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

## End-to-end test of goal #129 (2026-11-10, throwaway test front desk on its own roster, closed by pid)
- Start-up: the front desk's CronCreate of the tick was refused; it said "Check-in timer: not set. The Multi-Manager panel runs the check-ins itself" (e2e129-1).
- 11:56 quiet check-in: nothing in the chat; band "Last check 11:56 — all quiet" (e2e129-2).
- 12:06 check-in after a test note was raised: the panel started /multi-manager:tick itself; the front desk showed the note verbatim and marked it seen (e2e129-3).
- 12:16 check-in: quiet again, nothing in the chat, the seen note not re-sent (e2e129-4).
- Not seen live: the fallback when the panel cannot start the command; the old-timer "delete it" note (new front desk had no old timer). Mod tests cover both.

## Findings
- Residual 2-lines-per-quiet-check-in: fixed by 024 (goal #129), live after the plugin reload.
- The status line under the prompt is drawn with a ⚠ mark before "multi-manager:"; seen in the test front desk, cause not confirmed (likely the engine's drawing of a plugin status line).
- Pane answers reach only the raiser (`hooks/register.tsx` answer → `answer_item` → nudge raiser); the front desk model is never told. The front desk tab has no `MM_SESSION_ID`, so the Stop/SessionStart hooks do nothing there.
- The pane drops `watcher_nudge`: a watching project manager is not told when the user answers from the pane.
- No item ever closes itself; answered items stay until closed by hand.

## Next
- Going live waits for the user's go: front desk roster server restart (020) and plugin reload (021, 022).
- After the go: screenshot-only look at the real front desk over two check-ins (quiet leaves nothing; the old timer gets one "delete it" check-in).
