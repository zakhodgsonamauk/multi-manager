# Status

Live handover for workstream `usage-efficiency`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-24 19:27

## Current goal
Roster goal #2: make Multi-Manager use less Claude usage. State: in-progress.
Plan and testing approach signed off 2026-11-24 in item #2. The user's answer, verbatim: "go on all as recommended, except: q2 - ideally we'd wrap plugins in some sort of middle-man so they're still available, but only stuck into context when relevant. "
Findings: `findings.md` in this folder.

## In flight
- 029 Skills through a middle-man: dev session #7 (Sonnet), tab `mm-multi-manager-usage-efficiency-dev-029-skill-broker`, branch `worktree-mm-multi-manager-usage-efficiency-dev-029-skill-broker`, round 2 (sent back 19:24: voice plugin kept on, argument substitution, bad plugins file).

## Merged
- 027 Fresh start for big, idle managers: `02cce66` (2026-11-24, 2 rounds). Two minor review points are carried into 026: the clean-up after a failed kill during idle stop, and the request expiry re-asking. Not yet run in a real tab.
- 028 Cheaper helper agents, Fable and nudges: `6d13b5a` (2026-11-24). It includes the front desk's refresh_due line in commands/tick.md.
- 030 Use only the C:\dev copy: `ff8a5c4` (2026-11-24). Two desktop shortcuts now point at C:\dev; a one-line warning appears when anything runs from another copy. Running sessions keep their copy until next start. A throwaway test cluster roster sits in the Dropbox copy's scratch-ignored folder (not moved).

## Queued (in order)
- 031 Tool connections through a middle-man: runs after 029, and only if 029's numbers show it is worth it.

## Paused / parked
- (none)

## Findings (record-only)
- Q3: the "Other active sessions" line stays as it is. The user's agreed default was to turn it off only if it could be switched off per tab, and claude-context-sync has no per-tab switch.

## Next
- Review 027 when it comes back.
- Dispatch 026 once 027 is merged.
