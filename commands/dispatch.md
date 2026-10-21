---
description: Architect - hand one task file to one developer (one branch, one worktree, one tab)
argument-hint: <task number or task file path>
---
Dispatch a task. Arguments: $ARGUMENTS

One task = one branch = one worktree = one developer tab.

1. `team_health`. If `paused` is true, stop: start nothing.
2. Check the task file is complete (goal, tests first, files, out of scope, test scope) and committed on your workstream branch. Make sure no running task edits the same function.
3. Keep the PC lean: only as many developers at once as the project's caps (`get_limits`) and the machine allow.
4. `launch_developer` with label `NNN-slug` (short) and task: "Task NNN. Read <absolute path of the task file> first and follow it. Write your return report to <tasks folder>/NNN-slug.return.md on your branch, then raise_item kind done pointing at it."
5. Fill in the branch at the top of the task file. In `status.md`, move the task to In flight with its session id, tab and branch. Log the dispatch in `progress.md`.
6. For a small slice, a helper agent in its own git worktree can do it instead: give it the developer briefing (`get_briefing` role `developer`) and the task file, and `register_session` it.
