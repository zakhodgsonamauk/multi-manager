# Status

Live handover for workstream `usage-efficiency`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-24 19:05

## Current goal
Roster goal #2: make Multi-Manager use less Claude usage. State: in-progress.
Plan and testing approach signed off 2026-11-24 in item #2. The user's answer, verbatim: "go on all as recommended, except: q2 - ideally we'd wrap plugins in some sort of middle-man so they're still available, but only stuck into context when relevant. "
Findings: `findings.md` in this folder.

## In flight
- 027 Fresh start for big, idle managers: dev session #4 (Sonnet), tab `mm-multi-manager-usage-efficiency-dev-027-fresh-context`, branch `worktree-mm-multi-manager-usage-efficiency-dev-027-fresh-context`, round 1.

## Merged
- (none)

## Queued (in order)
- 026 Check-ins that cost nothing when nothing happened: waits for 027 to merge, and for item #4 (the unsaved files).
- 028 Cheaper helper agents, Fable and nudges: waits for item #4.
- 029 Plugins through a middle-man, redesigned to match the user's answer to Q2: research is in progress. It also waits for item #4, because it touches `launcher.ts`.
- Q4: make `C:\dev` the only plugin copy. The task is still to be written.

## Paused / parked
- (none)

## Findings (record-only)
- Q3: the "Other active sessions" line stays as it is. The user's agreed default was to turn it off only if it could be switched off per tab, and claude-context-sync has no per-tab switch.

## Next
- Review 027 when it comes back.
- Redesign 029 from the research.
- Write the Q4 task.
- Dispatch 026 and 028 once item #4 is settled.
