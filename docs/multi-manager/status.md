# Status

Live handover for workstream `main`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-01 18:15

## Current goal
Roster goal #10: fix developer tabs dying at launch, and start each developer's copy from its area's branch. State: done (on main as b08df4e; running sessions not restarted, the user decides when).
Tasks: 006 (architect: capture the real error), 007 (launcher makes the developer's copy itself from the workstream branch). Then the architect's end-to-end check: a real developer tab in a throwaway project stays up, is on the right branch, and checks in.

## Earlier goal
Roster goal #15: finish the local track `clusters_models_20261022` (cluster folders + model routing). State: done.
Plan sign-off: not needed. The user's words in goal #15: "proceed without user input as far as possible."

## Already done before this goal (earlier session, on `main`)
Plan tasks 1-5, 9, 12: model rule, `--model` flag, schema, model ledger, cluster launch command, briefing + `/multi-manager:set-model`.

## Also done
Roster goal #17: close controls in the pane. Done 2026-10-23 (item #139).

## In flight
- (none)

## Merged
- Follow-up: long file paths in developer copies: `fe94a89` (2026-11-01).
- 006 + 007 Developer tabs no longer die; copies start from the workstream branch: `b08df4e` (2026-11-01, goal #10). Branch fix/dev-launch kept (deleting branches is the user's call).
- 001 Launch on chosen model + change model: `d57de71` (2026-10-23, 2 rounds).
- 002 Cluster folder pop-up: `c954d27` (2026-10-23, 3 rounds).
- 005 Pick up a late process id and conversation: `915f03e` (2026-10-23, 2 rounds).
- 004 Cluster front desk gets its own name: `1f3b817` (2026-10-23).
- Outside-review follow-ups: `c52696b`; process snapshot fix `160bb6f`; briefing cap `5b6a1b7`.
- 003 Pane close controls (goal #17): `e6e001f` + review follow-up `e599c81` (hidden workstream's goals hide too) (2026-10-23).

## Queued (in order)
- (none)

## Paused / parked
- (none)

## Findings (record-only)
- F1: developer copies start from the old remote version (9fcaaed), not this workstream's latest `main`; both developers told to pull in `main` first. Local `main` is ahead of the remote (unpushed). Tool bug worth a task later.
- F2: every front desk was named mm-front-desk, so with two open, messages to it fail as ambiguous (seen tonight: two mm-front-desk sessions). Fixed for clusters by task 004. Architect/developer names can still collide across clusters with the same project name.
- F3: a team-folder architect tab opens in the same Terminal window as the main team's architects (one named window for all). Cosmetic.
- F4: the first time Claude opens a new folder (team folder or project folder) it stops at "trust this folder?"; the launcher then misses the tab's process id and conversation for good (task 005).
- F6 (2026-11-01): in a project folder Claude has never opened, a developer's copy stops at Claude's "trust this folder?" question (seen in a brand-new throwaway project). Projects where an architect has already run are trusted, so not seen in real use yet. A developer tab would sit waiting, not die.
- F7 (2026-11-01 20:15): the live process list (used by the monitor to spot dead tabs, and the resources tool) failed to read for a few minutes: "SyntaxError: Expected ',' or '}' after property value in JSON at position 302655". Some running program's details broke the list's format, like F-fix 160bb6f but a different character. Gone by the time it was examined, so the bad text was not captured; while it lasts, the monitor is blind. Next time: capture the raw list, then make the reader skip one bad row instead of failing the lot.
- F5: pane polish: with every project hidden it says "No projects yet"; an answered item can stay listed until the next 15 s refresh. Cosmetic.

## Next
Goal #10 done. Running sessions load the old launcher until restarted: each architect's own roster tool does the launching, so tell-me-a-story-2's architects need a restart (user's call) before developer tabs work for them. F1 fixed by goal #10.
