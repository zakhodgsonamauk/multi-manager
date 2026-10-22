# 002 — return report (round 1)

Branch: `worktree-mm-multi-manager-main-dev-002-picker`. Code commits: `43a4a00` (tab script + tests), `9ffdddb` (picker, runner, bat, README). This report is the commit after them.

Note: my copy started from an old version (9fcaaed). On the architect's instruction (#46) I ran `git merge --ff-only main` before starting, which fast-forwarded the branch to `1cf2233`. No other merges or rebases.

## What changed
- **Front desk tab sets its own environment** (`src/launch/front-desk-launch.ts`). `frontDeskCommand` now returns a `wt.exe` command whose tab runs `pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand <script>`, as architect/developer launches do. The script removes the eight inherited Claude Code variables `front-desk.bat` used to clear, sets `CLAUDE_CODE_NO_FLICKER=1`, sets `MM_ROSTER_DB` to `<folder>\.multi-manager\roster.db`, changes to the folder and runs `claude -n mm-front-desk [--remote-control mm-front-desk] --plugin-dir <plugin> --dangerously-skip-permissions /multi-manager:front-desk`. It no longer returns an `env` for `wt.exe`; it returns `rosterDb` instead. `-d <folder>` is escaped for `wt.exe`'s `;`. New exports: `frontDeskScript`, `INHERITED_CLAUDE_VARS`.
- **New `scripts/front-desk-launch.ts`**: `--folder <dir> --plugin-dir <dir> [--remote]`. Checks that the folder exists, opens the tab with `frontDeskCommand` (same `wt.exe` lookup as the launcher, environment cleaned with `launchEnv`), waits for Windows Terminal to start, and on failure exits 1 with the reason on stderr.
- **New `front-desk-picker.ps1`** (the pop-up): folder box (browse or paste; a path in quotes is fine), prefilled with the last folder; "Reachable from my phone (Remote Control)" checkbox; OK / Cancel. Fixes from the task:
  - OK reads the form's `DialogResult` (no click-handler variable, so the plan's scope bug cannot happen). A bad folder shows a message and keeps the pop-up open.
  - Window sized by client area with a fixed dialog border; Cancel sits inside it (see screenshots).
  - Message boxes if `node` or `pwsh` is missing, if the launcher file is missing, or if the launch fails (shows the launcher's own reason).
- **`front-desk.bat`** now only opens the pop-up (hidden console, so no black window behind it), with a comment saying what it does and that `front-desk.bat remote` became the checkbox.
- **README**: "Use" section now describes the pop-up and per-folder rosters instead of the command line; the "where data lives" paragraph mentions the cluster roster.

## Tests run

`node --test test/front-desk-launch.test.ts`
```
✔ clusterDbPath nests the roster inside the cluster folder (0.8404ms)
✔ the tab opens a new Terminal window in the chosen folder (0.9815ms)
✔ the tab script sets the cluster roster itself, not through the wt.exe environment (0.1807ms)
✔ the tab script sets CLAUDE_CODE_NO_FLICKER=1 so the side pane can dock (0.1956ms)
✔ the tab script removes every inherited Claude Code variable before running claude (0.3099ms)
✔ the tab script runs claude as the front desk with the plugin and no permission prompts (0.3178ms)
✔ remote control adds --remote-control mm-front-desk only when ticked (0.2545ms)
✔ paths with spaces, parentheses, quotes and semicolons survive (0.1626ms)
✔ two folders yield two different roster DBs (isolation) (0.3418ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
```
(Before the code change the same file failed: `ℹ pass 0` / `ℹ fail 1`, missing export.)

`npm run typecheck` → `tsc --noEmit -p tsconfig.json`, no output, exit 0.
`npm run lint` → `eslint .`, no output, exit 0.

PowerShell parse check. The plan's command, run verbatim, fails with `An error occurred while creating the pipeline.` — it fails the same way on the one-line script `1+1`, so the command is broken (`[void]` cast plus `| Out-Null`), not the picker. Corrected form, run in Windows PowerShell 5.1 (what `front-desk.bat` uses):
```
powershell -NoProfile -Command "$errs = $null; [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw 'front-desk-picker.ps1'), [ref] $errs) | Out-Null; if ($errs.Count) { $errs } else { 'picker ok' }"
picker ok
```
Also parsed with PowerShell 7's parser: `pwsh parse ok`.

Launcher failure paths (real `scripts/front-desk-launch.ts`, nothing opened):
```
--- missing folder
The folder does not exist: C:\no\such\folder
exit 1
--- no wt.exe   (LOCALAPPDATA pointed at an empty scratch folder)
Could not start Windows Terminal (...\scratchpad\empty\Microsoft\WindowsApps\wt.exe): spawn ...\wt.exe ENOENT
exit 1
--- usage
usage: front-desk-launch.ts --folder <dir> --plugin-dir <dir> [--remote]
exit 1
```

Tab script run for real in `pwsh` with a stand-in `claude` function (parent variables `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET` set first), folder `...\scratchpad\clusters\Team (Alpha) one`, remote ticked:
```
claude args: -n | mm-front-desk | --remote-control | mm-front-desk | --plugin-dir | I:\Dropbox (Personal)\Projects\multi-manager | --dangerously-skip-permissions | /multi-manager:front-desk
MM_ROSTER_DB=...\scratchpad\clusters\Team (Alpha) one\.multi-manager\roster.db
CLAUDE_CODE_NO_FLICKER=1
cwd=...\scratchpad\clusters\Team (Alpha) one
left over:
```

Pop-up driven for real (helper: `docs/multi-manager/tasks/002-shots/drive-picker.ps1`). PATH started with a fake `node.cmd` that only records its arguments, and `LOCALAPPDATA` pointed at a scratch folder, so no front desk opened and nothing outside the scratch folder was written. Driver output:
```
cancel:        picker exit code: 0 / node called: False / remembered folder: (none)
bad folder:    pop-up still open after bad folder: True / picker exit code: 0 / node called: False
OK (quoted path with spaces and brackets, remote ticked):
               picker exit code: 0 / node called: True
               node args: --no-warnings "...\scripts\front-desk-launch.ts" --folder "...\clusters\Team (Alpha) one" --plugin-dir "I:\Dropbox (Personal)\Projects\multi-manager\.claude\worktrees\mm-multi-manager-main-dev-002-picker" --remote
               remembered folder: ...\clusters\Team (Alpha) one
launch fails:  picker exit code: 1 / node called: True / remembered folder: (none)
node and pwsh missing: picker exit code: 1 / node called: False
```
Through `front-desk.bat` itself (as a double-click would): the picker it starts has the command line
`powershell  -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "I:\Dropbox (Personal)\...\front-desk-picker.ps1" -PluginDir "I:\Dropbox (Personal)\...\mm-multi-manager-main-dev-002-picker"` (no trailing backslash swallowing the quote). Cancel → node not called; OK → node called with the folder, folder remembered; reopened → folder prefilled. No picker or driver processes left afterwards (`leftover: 0`).

## Screenshots (opened and judged)
All in `docs/multi-manager/tasks/002-shots/`.
- `popup-empty.png`: first open. Label, folder box, Browse, grey hint ("Each folder is its own team..."), phone checkbox, OK and Cancel all fit inside the window with even margins. Looks right.
- `popup-pasted-path-remote.png`: quoted path pasted, phone box ticked. Box scrolls, nothing overlaps. Looks right.
- `popup-remembered-folder.png`: reopened through `front-desk.bat`; the last folder is prefilled. Looks right.
- `message-bad-folder.png`: "That folder does not exist. Browse for it, or paste the full path." Clear.
- `message-launch-failed.png`: "Could not open the front desk." plus the launcher's reason. Clear (an earlier version showed PowerShell error noise; fixed so only the reason shows).
- `message-missing-tools.png`: "Cannot open the front desk: node and pwsh not found." plus how to install both. Clear.

## Decisions made
Logged in `docs/multi-manager/decisions.md` under "2026-10-23 — Front desk picker details (task 002)":
- OK closes only for an existing folder; result read from `DialogResult`; Enter = OK, Esc = Cancel; quoted paths accepted.
- Last folder remembered only after a successful launch, in `%LOCALAPPDATA%\multi-manager\last-cluster.txt`.
- Tab clears exactly the eight variables the old bat cleared (not every `CLAUDE_CODE_*`), so a user's own Claude Code settings still apply.
- Front desk tab does not join a kill-on-close Job or write pid/exit files (it is not a launcher-managed session).
- Bat hides the console and strips its trailing backslash.

## Gaps
- **No real front desk was opened** (out of scope by the task). Not proven end to end here: that Windows Terminal runs the encoded tab, that the roster tool connection and hooks inside the front desk pick up `MM_ROSTER_DB` from the process environment (the hooks read it via `resolveDbPath`; the tool connection should inherit Claude's environment, unverified), and that architects it launches land in the cluster roster. Left for the architect's click-through.
- The Browse button's folder dialog was not opened in the automated run (standard Windows dialog; only the text box path was driven).
- A cluster folder that is itself a git repo will show `.multi-manager/` as an untracked folder; nothing adds it to `.gitignore`. Not in this task's scope.
- Picker exit codes were not readable when started through `front-desk.bat` (the driver only finds the process afterwards); behaviour was checked through the fake node and the remembered-folder file instead.

---

# 002 — return report (round 2)

Branch: `worktree-mm-multi-manager-main-dev-002-picker`. Code commit: `0f4cdea` (this report follows it). Round 1 above stays as it was; where it conflicts, this section wins.

## What changed (one line per send-back item)
1. **Way back to the main team.** The pop-up now offers "My main team (no folder): the shared roster on this PC" or "A cluster folder...". Main team = the old bat's launch: opened in the plugin folder, no `MM_ROSTER_DB` set (an inherited one is cleared, so it really is the shared roster). The remembered choice covers it (`main` or the folder). Nothing remembered → main team. README describes both. `frontDeskCommand({ cluster: null, ... })` / runner `--main`.
2. **`.gitignore` in the cluster's `.multi-manager`.** `ensureClusterDir` (tested helper in `src/launch/front-desk-launch.ts`) creates the folder and writes `*` with flag `wx`; "already exists" is ignored; the folder's own `.gitignore` is never touched. The runner calls it before opening the tab.
3. **Curly single quotes.** `psQuote` (`src/launch/wrapper.ts`) now doubles U+2018, U+2019, U+201A and U+201B as well as `'`. This covers architect and developer tabs too.
4. **Session identity cleared.** The tab script removes `MM_ROLE`, `MM_SESSION_ID`, `MM_PARENT_ID`, `MM_VOICE` (and `MM_ROSTER_DB`, then sets it only for a cluster) as well as the eight Claude variables.
5. **Runner environment and tests.** `launchEnv` is gone from the runner; `frontDeskEnv` drops only the eight Claude variables and the four `MM_*` ones (Windows names compared ignoring case), so other `CLAUDE_CODE_*` settings pass through. The runner logic is now `runFrontDeskLaunch` (injected spawn); `scripts/front-desk-launch.ts` only wires it up. Unit tested: missing folder, spawn options, spawn error, non-zero exit, `--main`, bad argument combinations.
6. **Waits for `wt.exe` to exit**; a non-zero exit (or a signal) is a failure with the code in the message. Wording fixed in decisions.md.
7. **Remember file is UTF-8** (`Set-Content`/`Get-Content -Encoding UTF8`). Remembering now happens after the main error handler, in its own silent `try`: if only that fails, no message (the desk did open).
8. **Screenshots retaken** with neutral paths (`C:\work\Team (Alpha) one`); the three old pop-up shots are deleted. They still exist in round 1's commit on this branch; a squash-merge leaves them out of `main`.
9. **README** warns that a cluster folder in Dropbox or another synced folder syncs a live database: use it from one PC, or pick a folder outside sync. The pop-up's hint says the same.

## Tests run

`node --test test/front-desk-launch.test.ts test/wrapper.test.ts test/command.test.ts` (`command.test.ts` added because the `psQuote` change reaches architect launches):
```
✔ clusterDbPath nests the roster inside the cluster folder
✔ the tab opens a new Terminal window in the chosen folder
✔ the tab script sets the cluster roster itself, not through the wt.exe environment
✔ the tab script sets CLAUDE_CODE_NO_FLICKER=1 so the side pane can dock
✔ the tab script removes every inherited Claude Code and session-identity variable before running claude
✔ the tab script runs claude as the front desk with the plugin and no permission prompts
✔ remote control adds --remote-control mm-front-desk only when ticked
✔ the main team (no cluster folder) opens in the plugin folder and sets no MM_ROSTER_DB
✔ paths with spaces, parentheses, quotes and semicolons survive
✔ a curly apostrophe in the folder is doubled so PowerShell keeps it inside the string
✔ two folders yield two different roster DBs (isolation)
✔ frontDeskEnv drops only the inherited Claude and session-identity variables
✔ ensureClusterDir creates .multi-manager with a .gitignore of * and never touches the folder's own .gitignore
✔ ensureClusterDir leaves an existing .multi-manager\.gitignore alone
✔ runner: a missing folder exits 1 with the reason and starts nothing
✔ runner: spawns wt.exe detached, output ignored, with the cleaned environment, and waits for it to exit
✔ runner: a spawn error exits 1 with the reason
✔ runner: wt.exe exiting non-zero is a failure
✔ runner: --main opens the main team in the plugin folder and prepares no cluster folder
✔ runner: exactly one of --main and --folder, and --plugin-dir, are required
✔ FRONT_DESK_CLEARED_VARS is the inherited set plus MM_ROSTER_DB
✔ psQuote doubles single quotes
✔ psQuote doubles the curly single quotes PowerShell also treats as quotes
...
ℹ tests 47
ℹ pass 47
ℹ fail 0
```
(Written first: before the code change, `front-desk-launch.test.ts` failed to load and the curly-quote `psQuote` test failed: `ℹ pass 10` / `ℹ fail 2`.)

`npm run typecheck` → `tsc --noEmit -p tsconfig.json`, exit 0. `npm run lint` → `eslint .`, exit 0.

Picker parse check (corrected form; see round 1 for why the plan's own command fails): `picker ok` (Windows PowerShell 5.1), `pwsh parse ok` (PowerShell 7), and the file is ASCII only (Windows PowerShell reads a .ps1 without a BOM as ANSI).

Tab script run for real in `pwsh` with stand-ins for `claude` and `Set-Location`. Before it ran, the parent shell had `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, the four `MM_*`, a cluster `MM_ROSTER_DB` and a user setting `CLAUDE_CODE_MAX_OUTPUT_TOKENS` set:
```
--- folder with a curly apostrophe
cd to: <scratch>\clusters\Zak’s folder
claude args: -n | mm-front-desk | --plugin-dir | C:\plugins\multi-manager | --dangerously-skip-permissions | /multi-manager:front-desk
MM_ROSTER_DB=[<scratch>\clusters\Zak’s folder\.multi-manager\roster.db]
CLAUDE_CODE_NO_FLICKER=1
user setting kept: CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
left over: []
--- main team
cd to: C:\plugins\multi-manager
claude args: -n | mm-front-desk | --plugin-dir | C:\plugins\multi-manager | --dangerously-skip-permissions | /multi-manager:front-desk
MM_ROSTER_DB=[]
CLAUDE_CODE_NO_FLICKER=1
user setting kept: CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
left over: []
```

Real `scripts/front-desk-launch.ts`, nothing opened:
```
--- missing folder
The folder does not exist: C:\no\such\folder
exit 1
--- no wt.exe   (LOCALAPPDATA pointed at an empty scratch folder)
Could not start Windows Terminal (<scratch>\empty\Microsoft\WindowsApps\wt.exe): spawn <scratch>\empty\Microsoft\WindowsApps\wt.exe ENOENT
exit 1
--- usage
usage: front-desk-launch.ts (--folder <dir> | --main) --plugin-dir <dir> [--remote]
exit 1
--- both
usage: front-desk-launch.ts (--folder <dir> | --main) --plugin-dir <dir> [--remote]
exit 1
```

Pop-up driven for real (`docs/multi-manager/tasks/002-shots/drive-picker.ps1`: a fake `node.cmd` records its arguments, `LOCALAPPDATA` is a scratch folder, so nothing real opens). Each case ran on its own, one after another:
```
--- first-open (nothing remembered)         picker exit code: 0 / node called: False / remembered folder: (none)
--- pasted-remote (cancel)                   picker exit code: 0 / node called: False / remembered folder: (none)
--- remembered-folder (seeded, cancel)       picker exit code: 0 / node called: False / remembered folder: C:\work\Team (Alpha) one
--- main-ok (seeded folder, pick main, phone ticked)
    picker exit code: 0 / node called: True
    node args: --no-warnings "...\scripts\front-desk-launch.ts" --main --plugin-dir "...\mm-multi-manager-main-dev-002-picker" --remote
    remembered folder: main
--- cluster-ok (seeded main, pick a real folder)
    picker exit code: 0 / node called: True
    node args: --no-warnings "...\scripts\front-desk-launch.ts" --folder "<scratch>\clusters\Team (Alpha) one" --plugin-dir "...\mm-multi-manager-main-dev-002-picker"
    remembered folder: <scratch>\clusters\Team (Alpha) one
--- bad-folder                               pop-up still open after bad folder: True / picker exit code: 0 / node called: False
--- main-launch-fails (seeded folder)        picker exit code: 1 / node called: True (--main) / remembered folder: C:\work\Team (Alpha) one  (unchanged)
--- remember-blocked (a file where the remember folder goes, pick main, OK)
    picker exit code: 0 / node called: True (--main) / remembered folder: (none)   (no message box: the run would have hung otherwise)
--- bat-remembered-main (through front-desk.bat, seeded main, cancel)
    picker command line: powershell  -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "...\front-desk-picker.ps1" -PluginDir "...\mm-multi-manager-main-dev-002-picker"
    node called: False / remembered folder: main
leftover: 0
```

## Screenshots (opened and judged)
All in `docs/multi-manager/tasks/002-shots/`; no user name or temp path in any of them.
- `popup-first-open-main.png`: nothing remembered → "My main team" selected; folder box and Browse greyed. Everything fits, Cancel inside the window. Right.
- `popup-main-team-chosen.png`: a remembered folder, then main picked and phone ticked: folder shown greyed, main selected. Right.
- `popup-pasted-path-remote.png`: cluster picked, `"C:\work\Team (Alpha) one"` pasted with quotes, phone ticked. Right.
- `popup-remembered-folder.png`: reopened with a remembered folder: cluster selected, path filled in. Right.
- `popup-remembered-main-via-bat.png`: through `front-desk.bat` with `main` remembered: main selected. Right.
- `popup-bad-folder.png` + `message-bad-folder.png`: nonexistent folder; the message explains, the pop-up stays open. Right.
- `message-launch-failed.png`: "Could not open the front desk." plus the launcher's reason only. Right.
- `message-missing-tools.png` (from round 1, unchanged code path): names both missing tools and how to install them. Right.

## Decisions made
Logged in `docs/multi-manager/decisions.md` under "2026-10-23 — Front desk picker, round 2 (task 002 send-back)", plus the corrected wording of the wt.exe bullet in the round 1 entry:
- Nothing remembered → main team (it is the team already running here).
- The tab clears an inherited `MM_ROSTER_DB` too, so the main team always uses the shared roster. Cost: a user-set global `MM_ROSTER_DB` no longer applies to the pop-up's main team (README says so).
- Runner logic lives in `src/launch/front-desk-launch.ts` so it is unit tested; `--main` and `--folder` are mutually exclusive.

## Gaps
- Still no real front desk opened (out of scope); your click-through is the end-to-end check, now for both choices. In particular, unverified here: that the front desk's tool connection picks up `MM_ROSTER_DB` from its process environment.
- `.multi-manager\.gitignore` is created when the runner starts, so a launch that fails afterwards (e.g. `wt.exe` missing) still leaves that small folder behind. Harmless; the next launch reuses it.
- Round 1's deleted screenshots (one showed a temp path with the Windows user name) are still in this branch's history; a squash-merge keeps them out of `main`.
- This branch does not have your briefing-length fix from `main` (5b6a1b7), so the full `npm run check` here still shows that one failure. Not pulled in: I do not merge.

---

# 002 — return report (round 3)

Branch: `worktree-mm-multi-manager-main-dev-002-picker`. Code commit: `2c11d1a` (this report follows it).

## What changed
- **Cause:** `runFrontDeskLaunch` called `child.unref()` and then waited for the child's `exit`. Nothing else kept Node running, so Node ended the top-level `await` in `scripts/front-desk-launch.ts` with exit code 13 before `wt.exe` exited. The picker then showed "Could not open the front desk" with no reason, on every successful launch. My round 2 tests missed it: the fake child was an in-process event emitter, which never depends on Node staying alive.
- **Fix:** dropped `unref()` (and removed it from the `FrontDeskChild` type). `detached: true` still keeps the Terminal window independent of Node. A code comment says why it must not come back.
- **Tests:** the fake-spawn test now asserts `unref` is never called. A new test writes a small top-level-await `.mjs` that runs the real `runFrontDeskLaunch` with a real child (`node -e "setTimeout(() => {}, 300)"` standing in for `wt.exe`), runs it in a separate Node, and asserts exit code 0.

## Tests run

Written first, against the old code (`node --test test/front-desk-launch.test.ts`):
```
✖ runner: spawns wt.exe detached, output ignored, with the cleaned environment, and waits for it to exit (7.4003ms)
✖ runner: a top-level-await script stays alive until a real short-lived child exits, then exits 0 (115.9273ms)
ℹ tests 22
ℹ pass 20
ℹ fail 2
  AssertionError [ERR_ASSERTION]: the child is not unref()ed: Node must stay alive until wt.exe exits
  AssertionError [ERR_ASSERTION]: exit 13; stderr:
```
After the fix, `node --test test/front-desk-launch.test.ts test/wrapper.test.ts test/command.test.ts`:
```
✔ runner: a missing folder exits 1 with the reason and starts nothing (1.0023ms)
✔ runner: spawns wt.exe detached, output ignored, with the cleaned environment, and waits for it to exit (7.5912ms)
✔ runner: a spawn error exits 1 with the reason (1.5012ms)
✔ runner: wt.exe exiting non-zero is a failure (1.3539ms)
✔ runner: --main opens the main team in the plugin folder and prepares no cluster folder (0.7947ms)
✔ runner: exactly one of --main and --folder, and --plugin-dir, are required (0.2435ms)
✔ runner: a top-level-await script stays alive until a real short-lived child exits, then exits 0 (429.6663ms)
ℹ tests 48
ℹ pass 48
ℹ fail 0
```
`npm run typecheck` exit 0. `npm run lint` exit 0.

Real `scripts/front-desk-launch.ts` with a stand-in `wt.exe`. This is a tiny program compiled for the test: it records its arguments, waits 800 ms and exits with a set code. `LOCALAPPDATA` pointed at a scratch folder holding it as `Microsoft\WindowsApps\wt.exe`, so nothing real opened:
```
--- stand-in wt.exe succeeds after 800 ms, --main
exit 0 after 960 ms
wt.exe got: -w new new-tab --title mm-front-desk -d . pwsh
--- stand-in wt.exe succeeds after 800 ms, --folder
exit 0 after 911 ms
wt.exe got: -w new new-tab --title mm-front-desk -d <scratch>\clusters\Team (Alpha) one pwsh
--- stand-in wt.exe exits 3 after 800 ms
Windows Terminal (<scratch>\fake-local-bad\Microsoft\WindowsApps\wt.exe) exited with code 3
exit 1 after 939 ms
```
(The `-d .` is because I passed `--plugin-dir .` by hand; the picker always passes the full path, as the next run shows.)

Whole chain: the pop-up, then the real `node` and launcher, then the stand-in `wt.exe` (succeeds after 800 ms), main team chosen, OK pressed (driver `-FakeWt` option, added to `002-shots/drive-picker.ps1`):
```
picker exit code: 0
remembered folder: main
stand-in wt.exe got: -w new new-tab --title mm-front-desk -d I:\Dropbox (Personal)\Projects\multi-manager\.claude\worktrees\mm-multi-manager-main-dev-002-picker pwsh
leftover: 0
```
The choice is only remembered after a successful launch, and no error box appeared (the driver would have hung waiting for the picker to exit), so the false "Could not open the front desk" is gone.

## Screenshots
None new: nothing visible changed.

## Decisions made
None new.

## Gaps
- Still no real Windows Terminal or front desk opened (out of scope); your click-through remains the end-to-end check.
- Same as round 2: this branch lacks your briefing fix from `main`, so the full `npm run check` here still shows that one failure.
