# 004 — return report (round 1, includes addenda 1 and 2)

Branch: `worktree-mm-multi-manager-main-dev-004-desk-name`. Last code commit: `1b00faa` (this report is committed on top).

## What changed
- **Each cluster front desk has its own name.** `frontDeskName` in `src/launch/front-desk-launch.ts`: main team `mm-front-desk` (unchanged), a cluster `mm-front-desk-<slug of the folder's name>` through the existing `sessionName` rule (`C:\work\Team (Alpha) one` → `mm-front-desk-team-alpha-one`). The same name goes into the Terminal tab title, `claude -n` and `--remote-control`. A drive root has no folder name, so the drive letter stands in (`D:\` → `mm-front-desk-d`).
- **The roster records it.** The cluster tab script sets `MM_FRONT_DESK_NAME` (after the clearing line, before `claude`). The main team sets none, and `MM_FRONT_DESK_NAME` was added to the variables the tab clears first, so an inherited one is removed. `start_front_desk` with no `name` now uses `frontDeskNameFromEnv()` (`src/roster/sessions.ts`): `MM_FRONT_DESK_NAME`, else `mm-front-desk`. An explicit `name` still wins. Nudges read the stored name, so `raise_item`'s `nudge.to` names the right front desk.
- **Wording.** `commands/front-desk.md` step 1: pass no `name` when opened by `front-desk.bat`/pop-up. `briefings/architect.md` line 5: "never assume `mm-front-desk` (a cluster's is `mm-front-desk-<folder>`)" (6739 characters, under the 7000 cap). README: one line on the names and `front-desk.bat remote`.
- **Addendum 1.** `front-desk.bat remote` passes `-Remote` to `front-desk-picker.ps1`, which pre-ticks "Reachable from my phone". The user can still untick it. With no argument the box starts unticked, as before.
- **Addendum 2.** The picker hands node the cluster folder without a trailing backslash, and a bare drive root as `D:\.`. What it remembers stays the resolved folder (`D:\`).

## Tests run
`node --test --test-timeout=30000 test/front-desk-launch.test.ts test/front-desk-name.test.ts test/server.test.ts test/briefings.test.ts test/sessions.test.ts`
```
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1281.5128
```
New tests: in `test/front-desk-launch.test.ts`, `frontDeskName` (main, cluster, trailing backslash, drive roots), a cluster name in title / `-n` / `--remote-control` / `MM_FRONT_DESK_NAME` (set after clearing and before claude), two folders give two names, and the main team gets title `mm-front-desk`, no `MM_FRONT_DESK_NAME`, with an inherited one cleared. The existing cluster tests now expect `mm-front-desk-alpha-team`. New file `test/front-desk-name.test.ts`: `frontDeskNameFromEnv`, plus three runs against a real roster server process in a temp folder. With no name and `MM_FRONT_DESK_NAME` set it uses that name, without it uses `mm-front-desk`, and an explicit name wins. Each run then raises an item to the front desk and checks that `nudge.to` names it. The new tests failed before the code (missing exports, and the drive-root case) and pass now.

`npm run typecheck`
```
> multi-manager@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
```
(no errors)

`npm run lint`
```
> multi-manager@0.1.0 lint
> eslint .
```
(no problems)

`claude plugin validate .`
```
✔ Validation passed
```
(plus the standing advice about a marketplace install line in README, unrelated)

PowerShell parse check of `front-desk-picker.ps1`: `pwsh7 parse errors: 0`, `ps5.1 parse errors: 0`; non-ASCII bytes in the picker: 0.

Whole chain, three runs. The picker was opened through `front-desk.bat`, then the real node launcher ran, with a stand-in `wt.exe` that only records its arguments. Driver: `docs/multi-manager/tasks/004-shots/drive-picker.ps1`, the 002 driver plus a `-BatArgs` option. A scratch folder was mapped as drive `Q:` with `subst`, so no real drive root was written to, and the mapping was removed afterwards.
- `front-desk.bat remote`, folder `Q:\`:
  ```
  picker command line: powershell  -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "...\front-desk-picker.ps1" -PluginDir "..." -Remote
  remembered folder: Q:\
  wt.exe got: ...\wt.exe -w new new-tab --title mm-front-desk-q -d Q:\. pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand <script>
  $env:MM_ROSTER_DB = 'Q:\.multi-manager\roster.db'
  $env:MM_FRONT_DESK_NAME = 'mm-front-desk-q'
  Set-Location -LiteralPath 'Q:\.'
  & claude '-n' 'mm-front-desk-q' '--remote-control' 'mm-front-desk-q' '--plugin-dir' '...' '--dangerously-skip-permissions' '/multi-manager:front-desk'
  ```
- `front-desk.bat` (no argument), main team:
  ```
  remembered folder: main
  wt.exe got: ...\wt.exe -w new new-tab --title mm-front-desk -d "..." pwsh ...
  & claude '-n' 'mm-front-desk' '--plugin-dir' '...' '--dangerously-skip-permissions' '/multi-manager:front-desk'
  ```
  (no `$env:MM_FRONT_DESK_NAME` line, no `--remote-control`)
- `front-desk.bat remote`, the box unticked by a click, main team: `& claude '-n' 'mm-front-desk' '--plugin-dir' ...` (no `--remote-control`).

## Screenshots (opened and judged)
- `docs/multi-manager/tasks/004-shots/popup-bat-remote-drive-root.png`: the pop-up opened by `front-desk.bat remote`. The phone box is ticked and `Q:\` is in the cluster box. Looks right.
- `docs/multi-manager/tasks/004-shots/popup-bat-plain-main.png`: the pop-up opened by plain `front-desk.bat`. The phone box is unticked and the main team is chosen. Looks right.

## Decisions made
Logged in `docs/multi-manager/decisions.md` under "2026-10-23 — Front desk name details (task 004, developer #52)":
- Drive roots are named after the drive letter (`mm-front-desk-d`), not the slug fallback `x`.
- A blank `MM_FRONT_DESK_NAME` counts as unset.
- `MM_FRONT_DESK_NAME` is cleared by the tab script. It is not added to the list dropped from wt.exe's environment, because the tab clears it anyway.
- `-Remote` only pre-ticks the box. The picker does not remember the phone choice (unchanged).

## Gaps
- **Addendum 2 was not reproduced here.** I gave the picker from `main` the folder `X:\` (a mapped scratch drive). It passed `X:\` to node intact and the launch went through. Windows PowerShell only quotes an argument that contains a space, and a drive root never does, so the backslash-escapes-the-quote problem did not happen on this PC. The fix is in as a harmless guard. If the user saw "The folder does not exist: D:", the cause may be something else, and I did not find it.
- Architect and developer names can still collide across two clusters that hold a project with the same name (out of scope, as the task says).
- An existing cluster roster whose front-desk record still says `mm-front-desk` is fixed on the next `start_front_desk`, which rewrites the name. Until that front desk is reopened through the pop-up, its nudges still say `mm-front-desk`.
- No real front desk was opened, no live roster touched, no session messaged or stopped.
