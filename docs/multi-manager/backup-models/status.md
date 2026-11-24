# Status

Live handover for workstream `backup-models`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-24 19:44

## Current goal
Roster goal #4: fold the backup Claude Code launchers (GLM via Ollama, LeaderGPU box, Strata) into Multi-Manager. State: in-progress.
Plan and testing approach signed off: 2026-11-24, item #13 (backups: glm, box, strata only; all roles; ask mode).

## In flight
- 033 Start a session on a backup: dev session #11, tab `mm-multi-manager-backup-models-dev-033-start-on-backup`, branch `worktree-mm-multi-manager-backup-models-dev-033-start-on-backup`, round 1 (sonnet; complexity 4, clarity 4).
- Model comparison (item #17, user: "compare them, with a very small coding task. speed and quality both to be judged"): helper agent rerunning GLM (Ollama started and stopped for the run) and the box with thinking off. First run: Strata 16/16 tests in 4.1 s; box wrote no code (all 2000 tokens spent thinking); GLM not reachable.

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
Review 033 when it returns. Report the model comparison to the user as an info item when the rerun finishes. If the box only works with thinking off, add that to the box definition in a follow-up.
