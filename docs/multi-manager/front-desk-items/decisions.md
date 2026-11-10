# Decisions — workstream `front-desk-items`

## 2026-11-10 Plan for goal #124
- Categories derived from item kind (signoff/question/blocked = needs action; done/info = information). No database change, so old running roster servers keep working.
- Auto-clear: open information items close 24 h after raised, or 1 h after raised once their goal is done/cancelled. Action items never auto-close. Runs in the existing background monitor pass. Alternative (close on "seen") rejected: the pane and front desk mark seen inconsistently.
- Pane answers reach the front desk as a context note added to its next turn by the pane mod's prompt hook (the mod runs inside the front desk). Alternative (Stop hook) rejected: the front desk tab has no roster id in its environment, and hooks identifying it by name are fragile.
- Quiet check-ins: the pane mod drops the scheduled `/multi-manager:tick` when a new small `front_desk_digest` says nothing needs doing. The timer stays as the fallback when the pane is not loaded. Alternatives: (a) remove the front desk timer and move nudges/idle-stop into server code (bigger, moves judgement out of the model); (b) keep ticks but shorten output (still 3+ chat lines every 10 minutes).

## 2026-11-10 "clear 60" scope
- User asked for "clear 60" that "clears anything older than 60 minutes". `/multi-manager:clear 60` closes information notes older than 60 minutes; decisions (sign-offs, questions, blockers) close only with `all` after one confirm, because closing a sign-off silently leaves an architect waiting forever. Alternative: close everything in one go (rejected for that reason).

## 2026-11-10 Task 021: pane details
- Project name on an item: the roster's `project` field when present (task 020), otherwise worked out from the raiser's session name (`mm-<project>-...`, longest project name that fits). Unknown stays blank.
- Closing an action item with the old Close button counts as a clear: the front desk hears about it too, same as Clear on an information line.
- "Recently answered" shows age ("5 min ago") rather than a clock time: no locale or time-zone guesswork inside the mod.
- Information items can only be read and cleared in the pane, not answered. A done report the user wants to reply to goes through the chat.
- The new `prompt.submit` hook only reads its own queue and adds a context entry; it never rewrites the prompt, so task 022 can add its own handler beside it.
