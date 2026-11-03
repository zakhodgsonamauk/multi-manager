# Status — workstream `pm-role` (goal #89)

Live handover. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-03 12:05

## Current goal
Roster goal #89: formalise the project manager role (front desk → project manager → architects → developers). State: done (reported 2026-11-03).
Plan and testing approach signed off: 2026-11-03, item #888 ("go").

## In flight
- (none)

## Merged
- 010 The roster knows the project manager role: `24123ba` (2026-11-03), pushed. Live roster backed up first to `~/.claude/multi-manager/roster.pre-task-010.db`.
- 011 Sign-offs straight to the front desk (project manager watches), standing rules per project, tool fixes: `155c99a` (2026-11-03), pushed.
- 013 Project manager briefing, pm-intake skill, front desk routing, README: `4feba69` (2026-11-03), pushed.
- 012 Status, team health and sidebar show the tree: `c5882e8` (2026-11-03), pushed. Pane judged from a rendered text screenshot (`tasks/012-shots/`).

## Queued (in order)
- (none)

## Paused / parked
- (none)

## Findings
- (none)

## Next
All four tasks merged and pushed; end-to-end run on a throwaway roster passed (9/9). Live steps, each only on the user's go (they interrupt running sessions):
1. Tabs started before the merges still run the old roster code; the front desk needs a fresh roster connection (restart its tab or reload the plugin) before it has `launch_project_manager`.
2. Relaunch #286 (today an architect on `multi-manager/pm`) as a real project manager, and the same for the financial-portal and digital-survey-platform `pm` architects.
3. Write each project's standing rules with `set_project_rules`, verbatim, from the lists in goals #69, #81, #89.
By design: on resume after a pause, every architect of a project with a project manager comes back under it, including ones the front desk launched.
