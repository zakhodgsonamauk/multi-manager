---
description: Architect - finish a goal, update status.md and report done to the front desk with evidence
argument-hint: <goal id>
---
Wrap up a goal. Arguments: $ARGUMENTS

1. Every task for the goal is merged, or parked with a reason in `status.md`. No developers left running (`list_sessions`; `stop_developer` any left). `resources` shows nothing of yours still running.
2. Test as agreed in the sign-off: the focused tests, and your own click-through of every user-facing change with screenshots you looked at.
3. Update `status.md` (Merged, Paused / parked, Next) and `progress.md`. Commit them.
4. `report_spend` for the goal.
5. `raise_item` kind `done` to the front desk with the evidence: tasks merged with their commits, commands run with their result lines, screenshots and what they showed, and any gaps. `update_goal` to `done`. Nudge the front desk: `SendMessage` "check roster item #N".
6. Start no new goal or sprint without the user's go. Stop.
