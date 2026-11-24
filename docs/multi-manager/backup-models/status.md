# Status

Live handover for workstream `backup-models`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-24 19:50

## Current goal
Roster goal #4: fold the backup Claude Code launchers (LeaderGPU box, Strata, GPT, GLM, MiniMax) into Multi-Manager. State: awaiting-signoff.
Plan and testing approach signed off: not yet.

## In flight
- none

## Merged
- none

## Queued (in order)
- 032 Backup backends: definitions and health checks (`docs/multi-manager/tasks/032-backup-backend-definitions.md`): waits for nothing.
- 033 Start a session on a backup (`tasks/033-start-session-on-backup.md`): waits for 032 and goal #2's 026, 027, 029, 031.
- 034 Switch a running session to a backup and back (`tasks/034-switch-session-backend.md`): waits for 033.
- 036 Show which backend each session runs on (`tasks/036-pane-shows-backend.md`): waits for 033 and goal #2's 026.
- 035 Notice usage ran out and offer the switch (`tasks/035-usage-ran-out-offer-switch.md`): waits for 034, 036, and goal #2's 026.
- Tidy: remove the untracked `claude-on-box.bat` / `claude-on-box-tools.ps1` copies from C:\dev\multi-manager (architect does it, if the user agrees).

## Paused / parked
- none

## Findings (record-only; numbers from `allocate_number` kind `finding`)
- none

## Next
Wait for the sign-off answer, then dispatch 032.
