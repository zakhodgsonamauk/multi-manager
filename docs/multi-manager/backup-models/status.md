# Status

Live handover for workstream `backup-models`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-24 19:44

## Current goal
Roster goal #4: fold the backup Claude Code launchers (GLM via Ollama, LeaderGPU box, Strata) into Multi-Manager. State: PAUSED (pause #1, item #34, 2026-11-24 19:56). Resume note at the end of progress.md.
Plan and testing approach signed off: 2026-11-24, item #13 (backups: glm, box, strata only; all roles; ask mode).

## In flight
- 033 Start a session on a backup: dev session #11, tab `mm-multi-manager-backup-models-dev-033-start-on-backup`, branch `worktree-mm-multi-manager-backup-models-dev-033-start-on-backup`, round 1 (sonnet; complexity 4, clarity 4). Code returned (item #26), HELD: review stopped for item #29; send-back round 1 to follow after 037 (headless real GLM check per item #27, thinking stays on per item #24, review findings).
- 037 Backend proxy tests must never open windows (URGENT, item #29): returned on branch `worktree-agent-ae098a58b56a1a937` (e4428b3). My verification run: no windows, no leftovers, but 1 of 17 tests fails. Not merged; stopgap still on main (454763c).
- Model comparison (item #17): done, reported as item #22; evidence in `comparison/`. Thinking stays ON (item #24: "i want good answer quality"); headless follow-up comparison (thinking on vs off, harder task) running; recommendation to user after.

## Merged
- 032 Backup backends: definitions and health checks: `c5908cf` (2026-11-24), after one send-back round.
- .gitignore: launcher copies kept but ignored (`81d036a`, 2026-11-24).

## Queued (in order)
- 034 Switch a running session to a backup and back (`tasks/034-switch-session-backend.md`): waits for 033.
- 036 Show which backend each session runs on (`tasks/036-pane-shows-backend.md`): waits for 033.
- 035 Notice usage ran out and offer the switch (`tasks/035-usage-ran-out-offer-switch.md`): waits for 034 and 036.

## Paused / parked
- none

## Findings (record-only; numbers from `allocate_number` kind `finding`)
- none

## Next
Review 033 when it returns. PAUSE RULE (user, item #23): ask the user before any real model test or tab on a backup; Strata is unloaded. Report the model comparison to the user as an info item when the rerun finishes. If the box only works with thinking off, add that to the box definition in a follow-up.
