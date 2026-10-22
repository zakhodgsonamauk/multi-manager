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

## Send-back round 1 (2026-10-23)
1. **No way back to the shared roster.** The live team on this PC runs on the global roster (`%USERPROFILE%\.claude\multi-manager\roster.db`). With the pop-up always using `<folder>\.multi-manager\roster.db`, once today's front desk closes the user cannot reopen it on that team (and `restore_all` needs it). Add a clear choice in the pop-up, e.g. a "Use my main team (no folder)" option (radio or checkbox) that opens the front desk exactly as the old bat did: no `MM_ROSTER_DB` set, folder = the plugin folder. The remembered choice should cover it too. README: describe both choices. Test: `frontDeskCommand` with no cluster folder sets no `MM_ROSTER_DB` (and still clears/sets the other variables).
2. `.multi-manager` shows as untracked when the cluster folder is a git repo. In `scripts/front-desk-launch.ts` (or a tested helper in `src/launch/front-desk-launch.ts`), create `<folder>\.multi-manager\` and write a `.gitignore` containing `*` with flag `wx` (ignore "already exists"). Never touch the user's own `.gitignore`. Unit test it.
3. `src/launch/wrapper.ts` `psQuote`: PowerShell also treats curly single quotes (U+2018, U+2019, U+201A, U+201B) as quotes, so `C:\Zak’s folder` breaks the tab script (architect tabs too). Double each of them as well as `'`. Test with a curly apostrophe in the folder.
4. Clear `MM_ROLE`, `MM_SESSION_ID`, `MM_PARENT_ID`, `MM_VOICE` in the front desk tab script too (a picker started from a managed session's shell must not inherit its identity). Test.
5. `scripts/front-desk-launch.ts:33`: `launchEnv()` strips every `CLAUDE_CODE_*`, which contradicts your logged decision to keep the user's own settings. Pass the environment with only the 8 inherited variables (and the 4 `MM_*` above) removed. Make the runner testable (injected spawn) and unit test: missing folder exits 1, spawn gets `detached` + `stdio: 'ignore'` + the cleaned environment, spawn error exits 1 with the reason.
6. `scripts/front-desk-launch.ts:35`: it only waits for the `wt.exe` stub to spawn. Wait for `wt.exe` to exit and treat a non-zero exit as a failure (as the architect launch does with its exit code). Fix the wording in decisions.md to match.
7. `front-desk-picker.ps1:132`: `Set-Content` in Windows PowerShell 5.1 writes ANSI; use `-Encoding UTF8` (and read it back the same way). If only the remember-write fails, do not report "Could not open the front desk": the desk did open.
8. `docs/multi-manager/tasks/002-shots/popup-pasted-path-remote.png` shows the Windows user name in a temp path. Retake it with a neutral path (e.g. `C:\work\Team (Alpha) one`), or crop it.
9. README: one line warning that a cluster folder inside Dropbox (or any synced folder) syncs a live database; use it from one PC only, or pick a folder outside sync.
Update your return report (round 2 section), then raise done again.
