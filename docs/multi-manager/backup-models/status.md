# Status

Live handover for workstream `backup-models`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-24 19:50

## Current goal
Roster goal #4: fold the backup Claude Code launchers (GLM via Ollama, LeaderGPU box, Strata) into Multi-Manager. State: in-progress.
Plan and testing approach signed off: 2026-11-24, item #13 (backups: glm, box, strata only; all roles; ask mode).

## In flight
- none

## Merged
- .gitignore: launcher copies kept but ignored (`81d036a`, 2026-11-24).

## Queued (in order)
- 032 Backup backends: definitions and health checks (`docs/multi-manager/tasks/032-backup-backend-definitions.md`): waits for nothing.
- 033 Start a session on a backup (`tasks/033-start-session-on-backup.md`): waits for 032 and goal #2's 026 (architect #3 messages when it merges).
- 034 Switch a running session to a backup and back (`tasks/034-switch-session-backend.md`): waits for 033.
- 036 Show which backend each session runs on (`tasks/036-pane-shows-backend.md`): waits for 033 and goal #2's 026.
- 035 Notice usage ran out and offer the switch (`tasks/035-usage-ran-out-offer-switch.md`): waits for 034, 036, and goal #2's 026.


## Paused / parked
- none

## Findings (record-only; numbers from `allocate_number` kind `finding`)
- none

## Next
032 dispatched. Answer the user's aside on Strata's model in an info item.
