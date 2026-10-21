---
description: Architect - review a developer's returned task, then squash-merge it or send it back
argument-hint: <roster item # or task number>
---
Review a returned task. Arguments: $ARGUMENTS

1. Read the `done` item, the task file (with any send-back rounds) and the return report on the developer's branch (`git show <branch>:<path>`).
2. Review: start a helper agent with the task file path, the diff (`git diff <your branch>...<their branch>`), the return report and the project rules (CLAUDE.md, decisions). It edits nothing and returns defects with file:line, missing tests, out-of-scope changes, and a verdict: merge or send back. Open every screenshot yourself and judge it.
3. **Merge** if it passes. On your workstream branch with a clean tree: `git merge --squash <branch>`. Read its output: an untracked file in the way, or a conflict, means nothing applied. Move the file aside or resolve, and redo. For append-only docs, keep both sides. Check `git status` shows the change staged, then commit `Task NNN: <title>` with a body naming the task file.
4. Run the focused tests from the task's test scope on the merged tree. If they fail, fix it or revert and send back.
5. After a merge: `stop_developer`, remove its worktree and branch, `close_item`. In `status.md` move the task to Merged with the commit. Log it in `progress.md`.
6. **Send back** otherwise. Append `## Send-back round N (date)` to the task file: numbered defects with file:line and the fix expected. Commit it. If the developer's tab is alive, `SendMessage` it "Send-back round N in <task file>: fix it, update your return report, raise done again". If its tab is gone, `restart_developer`. `close_item` the done item. Update the round in `status.md`.
7. After round 3, stop sending back: split the task, or raise kind `blocked` to the front desk.
