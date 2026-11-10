# Decisions — workstream `front-desk-items`

## 2026-11-10 Plan for goal #124
- Categories derived from item kind (signoff/question/blocked = needs action; done/info = information). No database change, so old running roster servers keep working.
- Auto-clear: open information items close 24 h after raised, or 1 h after raised once their goal is done/cancelled. Action items never auto-close. Runs in the existing background monitor pass. Alternative (close on "seen") rejected: the pane and front desk mark seen inconsistently.
- Pane answers reach the front desk as a context note added to its next turn by the pane mod's prompt hook (the mod runs inside the front desk). Alternative (Stop hook) rejected: the front desk tab has no roster id in its environment, and hooks identifying it by name are fragile.
- Quiet check-ins: the pane mod drops the scheduled `/multi-manager:tick` when a new small `front_desk_digest` says nothing needs doing. The timer stays as the fallback when the pane is not loaded. Alternatives: (a) remove the front desk timer and move nudges/idle-stop into server code (bigger, moves judgement out of the model); (b) keep ticks but shorten output (still 3+ chat lines every 10 minutes).
