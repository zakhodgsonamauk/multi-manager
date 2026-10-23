# Status

Live handover for workstream `main`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-10-23 02:45

## Current goal
Roster goal #15: finish the local track `clusters_models_20261022` (cluster folders + model routing). State: in-progress.
Plan sign-off: not needed. The user's words in goal #15: "proceed without user input as far as possible."

## Already done before this goal (earlier session, on `main`)
Plan tasks 1-5, 9, 12: model rule, `--model` flag, schema, model ledger, cluster launch command, briefing + `/multi-manager:set-model`.

## Also active
Roster goal #17: close controls in the pane (waiting items, goals, workstreams, projects); never nudge a stopped session. State: in-progress. No sign-off (same rule as #15).

## In flight
- (none)

## Merged
- 001 Launch on chosen model + change model: `d57de71` (2026-10-23, 2 rounds).
- 002 Cluster folder pop-up: `c954d27` (2026-10-23, 3 rounds).
- 004 Cluster front desk gets its own name: `1f3b817` (2026-10-23).
- Outside-review follow-ups: `c52696b`; process snapshot fix `160bb6f`; briefing cap `5b6a1b7`.
- 003 Pane close controls (goal #17): `e6e001f` + review follow-up `e599c81` (hidden workstream's goals hide too) (2026-10-23).

## Queued (in order)
- Wrap: desktop shortcut (plan task 11), full gate (task 13), outside review, click-through (task 14), by the architect.

## Paused / parked
- (none)

## Findings (record-only)
- F1: developer copies start from the old remote version (9fcaaed), not this workstream's latest `main`; both developers told to pull in `main` first. Local `main` is ahead of the remote (unpushed). Tool bug worth a task later.
- F2: every front desk was named mm-front-desk, so with two open, messages to it fail as ambiguous (seen tonight: two mm-front-desk sessions). Fixed for clusters by task 004. Architect/developer names can still collide across clusters with the same project name.

## Next
Click-through in a throwaway cluster folder (pop-up path via the launcher, isolated roster, front desk name, model on a launched architect, pane Close/Hide), then raise done for goals #15 and #17.
