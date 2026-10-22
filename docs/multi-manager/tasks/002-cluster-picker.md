# 002 — Open the front desk in a chosen folder, from a pop-up

Goal #15. Branch: `worktree-mm-multi-manager-main-dev-002-picker`. Return report: `docs/multi-manager/tasks/002-cluster-picker.return.md` on that branch.

## Goal
Double-clicking `front-desk.bat` opens a small pop-up: pick (browse or paste) a "cluster" folder, optionally tick "Reachable from my phone", OK. A new Windows Terminal tab opens the front desk in that folder, and that front desk (and every architect and developer it launches) keeps its whole roster in `<folder>\.multi-manager\roster.db`, so two folders are two fully separate teams. The pop-up remembers the last folder. No command line needed.

This is plan task 10 of the local plan `conductor/tracks/clusters_models_20261022/plan.md` (read it in the project folder `I:\Dropbox (Personal)\Projects\multi-manager`; it is git-ignored, so not in your copy). Use its picker and runner as a start, with the fixes below.

Already merged on `main`: `src/launch/front-desk-launch.ts` (`clusterDbPath`, `frontDeskCommand`) and `test/front-desk-launch.test.ts`.

## Must fix versus the plan
1. **The roster location must reach the front desk reliably.** The plan passes `MM_ROSTER_DB` as the environment of the `wt.exe` call. When Windows Terminal is already running, a new tab does not reliably inherit the caller's environment, so the front desk would silently use the global roster. Do what the architect/developer launches already do (`src/launch/command.ts` `buildLaunchCommand`, `src/launch/wrapper.ts` `encodeCommand`/`psQuote`/`PWSH_ARGS`): make the tab run `pwsh` with an encoded script that sets the variables itself, then runs `claude`. Change `frontDeskCommand` accordingly and update its tests (decode the script and assert it sets `MM_ROSTER_DB` to the cluster path).
2. **Keep what today's `front-desk.bat` does** (read it first): clear the inherited Claude Code variables (`CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_SESSION_ID`) and set `CLAUDE_CODE_NO_FLICKER=1` (the side pane needs it). Do it inside the tab's script so it holds however the picker was started. Test both.
3. **PowerShell scope bug in the plan's picker:** `$ok.Add_Click({ $confirmed = $true; ... })` sets a variable local to the click handler, so OK would never launch anything. Use `$script:confirmed` (or the form's `DialogResult`). Also make sure the Cancel button fits inside the window.
4. The picker must show a clear message box if `node` or `pwsh` is missing or the launch fails, instead of closing silently.

## Tests first
- `test/front-desk-launch.test.ts`: the decoded tab script sets `MM_ROSTER_DB` to `<folder>\.multi-manager\roster.db`, sets `CLAUDE_CODE_NO_FLICKER` to `1`, removes each inherited Claude variable, runs `claude` with `-n mm-front-desk`, `--plugin-dir <plugin folder>`, `--dangerously-skip-permissions` and `/multi-manager:front-desk`; `--remote-control mm-front-desk` only when remote is ticked; paths with spaces and parentheses (like `I:\Dropbox (Personal)\...`) survive.
- Keep the existing isolation test (two folders → two different roster paths).

## Files expected to change
- `src/launch/front-desk-launch.ts`, `test/front-desk-launch.test.ts`
- new `front-desk-picker.ps1`, new `scripts/front-desk-launch.ts`
- `front-desk.bat` (now just opens the picker; keep a comment saying what it does)
- `README.md` (replace any `front-desk.bat remote` / command-line instructions with the pop-up)

## Out of scope
- Model routing code (`src/launch/launcher.ts`, `src/roster/tools.ts`, task 001).
- Moving or copying the existing global roster into a cluster.
- Do not open a real front desk, and do not touch the live roster database (`%USERPROFILE%\.claude\multi-manager\roster.db`): sessions on this PC are running on it. The architect runs the real click-through after merge.

## Test scope
- `node --test test/front-desk-launch.test.ts`
- The PowerShell parse check from the plan (task 10 step 4) on `front-desk-picker.ps1`.
- You may open the pop-up itself to screenshot it, as long as you press Cancel (Cancel must launch nothing).
- `npm run typecheck` and `npm run lint`. Not the full suite.

## Evidence required
- Each command with its summary lines pasted verbatim.
- A screenshot of the pop-up (opened and judged: layout, labels, buttons fit).
