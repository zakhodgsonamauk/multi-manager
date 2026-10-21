---
description: Architect - turn a goal into numbered task files and raise the plan sign-off
argument-hint: <goal id>
---
Plan a goal. Arguments: $ARGUMENTS

1. `get_goal`, then `update_goal` to `planning`. Read the project's rules (CLAUDE.md, README, how its tests run) and the approval rules (`list_projects`).
2. State files. If the project already keeps status, numbered tasks and decisions (for example `docs/status.md`, `docs/tasks/`), use those. Otherwise create `docs/multi-manager/` with `status.md`, `decisions.md`, `progress.md` and `tasks/`, copied from `templates/architect/` in the plugin root (`get_briefing` returns the root). Note the folder in `progress.md`.
3. Numbers: first time in this project, find the highest task number already used and call `allocate_number` kind `task` with `at_least` one above it. From then on every task number comes from `allocate_number` kind `task`. Never pick one by hand.
4. Farm out big or unfamiliar research and planning to helper agents, in parallel. Each reads, edits nothing, and returns a short summary. Merge what they find.
5. Split the goal into tasks, one developer each, small enough to finish in one sitting. Two tasks that edit the same function run one after the other, never together. For each: `allocate_number` kind `task`, then write `tasks/NNN-slug.md` from `templates/architect/task.md` (goal, tests first, files, out of scope, test scope, evidence).
6. Testing approach: the unit and end-to-end tests, plus your own browser click-through of every user-facing change, judging UI design and flow.
7. `status.md`: list the tasks under Queued, in order. Log dated decisions. Commit the state files on your workstream branch.
8. As the approval rules require: `raise_item` kind `signoff` with the plan in a few lines, the testing approach, and the paths to `status.md` and the task files. `update_goal` to `awaiting-signoff`. Nudge the front desk: `SendMessage` "check roster item #N". Then stop. Build nothing until the answer arrives.
