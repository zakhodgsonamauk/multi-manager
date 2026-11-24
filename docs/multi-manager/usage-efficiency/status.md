# Status

Live handover for workstream `usage-efficiency`. A fresh architect resumes from this file and `progress.md`.
Updated: 2026-11-24 20:05

## Current goal
Roster goal #2: make Multi-Manager use less Claude usage. State: done (2026-11-24); waiting for the go-live reload, which the project manager coordinates.
Plan and testing approach signed off 2026-11-24 in item #2. The user's answer, verbatim: "go on all as recommended, except: q2 - ideally we'd wrap plugins in some sort of middle-man so they're still available, but only stuck into context when relevant. "
Findings: `findings.md` in this folder.

## In flight
- (none)

## Merged
- 026 Check-ins that cost nothing when nothing happened: `add9843` (2026-11-24, 3 rounds). The mod asks `manager_digest` in code and starts a turn only on news; no timer in the briefings.
- 029 Skills through a middle-man: `8b14024` (2026-11-24, 2 rounds). Tabs switch off other plugins and the claude.ai connectors, and `find_skill`/`load_skill` serve skills on demand. Headless runs measured the first turn at 48.4k -> 36.5k tokens, before the keep-list grew. Not yet checked in a real tab.
- 027 Fresh start for big, idle managers: `02cce66` (2026-11-24, 2 rounds). Two minor review points are carried into 026: the clean-up after a failed kill during idle stop, and the request expiry re-asking. Not yet run in a real tab.
- 028 Cheaper helper agents, Fable and nudges: `6d13b5a` (2026-11-24). It includes the front desk's refresh_due line in commands/tick.md.
- 030 Use only the C:\dev copy: `ff8a5c4` (2026-11-24). Two desktop shortcuts now point at C:\dev; a one-line warning appears when anything runs from another copy. Running sessions keep their copy until next start. A throwaway test cluster roster sits in the Dropbox copy's scratch-ignored folder (not moved).

## Queued (in order)
- (none)

## Paused / parked
- 031 Tool connections through a middle-man. Parked by the architect: decide after re-measuring real use. Would save at most about 7.6k tokens per call. Needs the user's go.
- Live tests of 026 and 027 in real windows. Not possible under the user's "only if headless" (item #25): a manager needs a real terminal. To be checked from real use after go-live.

## Findings (record-only)
- Q3: the "Other active sessions" line stays as it is. The user's agreed default was to turn it off only if it could be switched off per tab, and claude-context-sync has no per-tab switch.

## Next
1. Go-live: the project manager checks nothing else is running, then reloads the roster and plugin (user: "fine for reload etc", item #4). Sessions started before the reload keep the old behaviour until they restart.
2. After a day of real use, re-run `measure/extract.js` and `measure/analyze.js`. Compare with the baseline in `conductor/usage-baseline/`: tick turns, context per manager call, restarts. Then decide 031.
