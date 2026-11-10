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

## 2026-11-10 Goal #127: recognise the front desk by its own Claude Code session file
- After a roster server restart, the front desk is recognised when the server's parent process's session file (~/.claude/sessions/<pid>.json) names it the roster's front-desk name. Alternatives: give the front desk tab MM_ROLE=front-desk in its environment (only helps tabs opened after the change, and the tab deliberately clears identity variables); persist "last front desk server pid" in the database (breaks on every new server pid).

## 2026-11-10 Goal #129: the panel runs check-ins itself
- Claude Code always prints a hook's drop reason (API types: "A hook's text is shown to the user as the reason"), and the timer's "Running scheduled task" line comes before any hook. So no timer prompt can be silent. The panel already has its own 15-second loop and can start a turn with `$.command.run` (runs `/multi-manager:tick` as if typed). It asks the roster for the digest every 10 minutes and starts a check-in only when something needs the front desk, or when it cannot tell (roster away, error). The model's timer is refused while the panel runs check-ins; with the panel not loaded nothing refuses it, so the old timer is the automatic fallback. Alternatives: keep the timer at a longer interval (still two lines each time); have the roster server wake the front desk (it has no way to start a turn in another session).
- Digest re-sending seen items: `new_items` skips items marked seen, and the front desk is told to mark items seen after showing them (nothing told it to before). Alternative: rely on `since` only (fails whenever `since` is missing, e.g. the model's own digest call).

## 2026-11-10 Task 024: pane check-in loop
- The first scheduled `/multi-manager:tick` after the panel took over is let through once with a "CronList and CronDelete your tick job" note and is not judged by the digest; later scheduled ticks keep 022's digest-judged drop. Alternative: drop every scheduled tick at once (rejected: a model whose timer is the only live one would lose a check-in).
- "Pending" guard: the panel holds off a new check-in while its `$.command.run` call has not resolved, and ignores it after 30 minutes. The next due time is set when a check-in starts (10 minutes later), so a long turn does not cause an instant second one.
- The digest is stashed in module state and attached in `prompt.submit` when the tick arrives with origin `{ kind: 'plugin', name: 'multi-manager' }`; fingerprint and time are recorded only once that prompt went in.
- Fallback when `$.command.run` rejects: `$.prompt.submit({ text: '/multi-manager:tick', asUser: true })`.

## 2026-11-10 Task 024 round 2
- Loop liveness: `lastLoopAt` is written every 15-second turn; the model's tick timer is refused or told to delete itself only if it is under 30 seconds old. Stale + scheduled tick: restart the loop and judge the tick as in 022. Alternative: also restart from `CronCreate` (rejected: a refusal hook should not start things).
- The host refuses a prompt beginning with "/", so the fallback when `$.command.run` rejects is a plain-words prompt naming `multi-manager:tick`, with the digest inside its text.
- Sessions in another role skip the whole loop turn (no beat, poll or check-in).
