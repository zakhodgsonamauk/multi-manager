# Architect progress log

Workstream `usage-efficiency`, roster session #3, goal #2. Append-only, dated, newest last. This file and `status.md` are the record: they survive context summaries.

## Timer
Tick job id: `3187346e`, armed 2026-11-24. Re-arm at 6+ days. On a pause, delete it first.

## State files
Folder: `docs/multi-manager/usage-efficiency/` (status, decisions, progress). Task files go in the shared `docs/multi-manager/tasks/`. Highest task number already used there: 025; numbers come from `allocate_number` seeded at 26.

## Log
- 2026-11-24 18:14 Goal #2 received. User's words: "essentially i'm really struggling with claude code usage disappearing so i'm wondering if we can make multi-manager more efficient". PM note: measure first, then a plan sign-off, biggest savings first; work only in C:\dev\multi-manager.
- 2026-11-24 18:14 PM note: five uncommitted files in the project folder are not mine (briefings/architect.md, briefings/developer.md, commands/plan-goal.md, src/launch/launcher.ts, test/launcher.test.ts). Do not commit, revert or overwrite. Also asked: which plugin copy actually loads.
- 2026-11-24 18:15 Roster model-use records are empty (roster is fresh today), so measurement relies on transcripts under ~/.claude/projects. Two helper agents sent: (1) transcript token measurement by role/model/trigger, (2) audit of what the plugin injects per session and per idle hour, plus which plugin copy loads.
- 2026-11-24 18:40 Audit helper back. Top drivers: (1) the 10-minute check-in timer on Opus architects and project managers: each tick re-reads a 400k-700k-token context, ~44M cached-read tokens/hour across 7 idle Nuclear Option sessions; ticks are 32-99% of each session's cached reads. (2) User-level "Other active sessions" prompt hook (C:\dev\claude-context-sync, not this plugin) adds ~3k chars per prompt, up to ~19% of a long PM context. (3) ~70k-token start-up context per session, mostly third-party skill lists, deferred tool names and connectors; plugin's own briefing is small. (4) Architects/PMs always Opus (src/roster/models.ts:49); front desk inherits Opus from settings.json. (5) Idle auto-stop never fires: only reported to the front desk, architects only, and the session's own tick refreshes "last activity" (src/monitor/activity.ts:90), so 120 minutes of quiet is never reached. Plugin copy: loaded via --plugin-dir from whichever copy the front desk started from; this PM and architect run the Dropbox copy; code identical, C:\dev 2 docs commits ahead.
