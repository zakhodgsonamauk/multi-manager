# Architect progress log

Append-only, dated, newest last. This file and `status.md` are the record: they survive context summaries.

## Timer
Tick job id: `a35afd2e`, armed 2026-11-24. Re-arm at 6+ days. On a pause, delete it first.

## State files
Folder: `docs/multi-manager/backup-models/` (status, decisions, progress); task files in the shared `docs/multi-manager/tasks/`. Task numbers seeded at 32 with `allocate_number`.

## Log
- 2026-11-24 19:30 Goal #4 received (roster session #8, workstream backup-models). Tick armed.
- 2026-11-24 19:45 Two helper agents read the Dropbox launchers (no keys copied) and the Multi-Manager launch code. Findings in decisions.md.
- 2026-11-24 19:50 Plan written: tasks 032-036. Sign-off raised.
- 2026-11-24 19:40 Project manager: build waits for #13 answer, even 032; agree hand-off with architect #3 on 027. Sent #3 the hand-off proposal; tasks 033-035 updated.
- 2026-11-24 19:45 Architect #3 confirmed hand-off: 027/029 merged, wait only for 026 (they message on merge), not 031; no bypass of restartArchitect; out-of-usage guard on all three lifecycle decisions after 026. Task files 033/035 and status updated.
- 2026-11-24 19:31 Sign-off #13 answered. The user's words, verbatim: "Q2 - glm, then box, then strata ONLY . not impressed with the capabilities of qwen 3.8 on the box, and i assume Inkling mini 2 is worse still?. Q3 - all. Q4 - no, hold them for now but gitignore them". Q1 not answered: default [ask] applies. Plan and testing approach treated as signed off. Item #13 closed, goal #4 in-progress.
- 2026-11-24 19:33 Q4 done: `/claude-on-box.bat` and `/claude-on-box-tools.ps1` added to .gitignore (claimed and released), files kept. Tasks 032/034/035/036 updated: backups are glm, box, strata only, in that order; gpt and minimax dropped; batch switch covers every role, front desk last.
- 2026-11-24 19:32 Dispatched 032 to dev session #10 (sonnet, complexity 3 / clarity 4), branch worktree-mm-multi-manager-backup-models-dev-032-backends.
- 2026-11-24 19:36 Item #17 (via project manager), user's words verbatim: "compare them, with a very small coding task. speed and quality both to be judged". Helper agent running the comparison by calling glm, box and Strata directly (no tabs, no claude -p): one small coding task with hidden tests, plus one tool-call check, timed. Results go in the report and the goal's evidence.
- 2026-11-24 19:40 032 reviewed (outside reviewer: merge, four nice-to-haves). Sent back round 1: two of them can leave the litellm proxy running with no users (lean-PC rule): orphan on hung proxy, bare user counter; plus lock and litellm.exe check.
- 2026-11-24 19:40 032 round 2 reviewed and squash-merged as c5908cf. Focused tests 15/15 on merged tree, typecheck and eslint clean. Developer #10 stopped, temporary copy and branch removed.
- 2026-11-24 19:42 Architect #3: 026 merged (add9843), all of goal #2's code in, 031 undecided and not waited on. 033 unblocked; task file updated with 032's functions.
- 2026-11-24 19:43 Dispatched 033 to dev session #11 (sonnet, complexity 4 / clarity 4), branch worktree-mm-multi-manager-backup-models-dev-033-start-on-backup.
- 2026-11-24 19:43 Dispatched 033 to dev session #11 (sonnet, complexity 4 / clarity 4), branch worktree-mm-multi-manager-backup-models-dev-033-start-on-backup.
- 2026-11-24 19:47 Comparison finished (Ollama started for the glm run and stopped after). Reported as item #22. Evidence in docs/multi-manager/backup-models/comparison/.
- 2026-11-24 19:48 Item #23, user (verbatim, via front desk): "fyi i've unloaded strata, so pause before model tests". The comparison had already finished before this arrived. Told the 033 developer: no real-backup tests until a go; ask the user (raise an item) before any model test.
- 2026-11-24 19:50 Item #29 (front desk, blocked): backends.test.ts opened visible terminal windows and left 12 processes; user (verbatim): "you've opened loads of terminal windows wtf is going on". My own post-merge run of that test at 19:39 was one of the runs. Stopped the 033 reviewer and told the 033 developer to run nothing. No leftovers found. Stopgap 454763c: eight spawning tests skipped, python lookup hidden. Task 037 written for the real fix.
- 2026-11-24 19:50 Item #27 answered. User's words, verbatim: "can run tests but only if headless!". So: no on-screen tab for 033's real test; a headless run only. Q2 (GLM thinking off) not answered: default yes stands.
