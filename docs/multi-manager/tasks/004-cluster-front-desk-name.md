# 004 — Each cluster's front desk gets its own session name

Goal #15. Branch: `worktree-mm-multi-manager-main-dev-004-desk-name`. Return report: `docs/multi-manager/tasks/004-cluster-front-desk-name.return.md` on that branch.

## Goal
Messages between sessions are addressed by session name. Today every front desk is named `mm-front-desk`, so as soon as two front desks are open (the main team plus a cluster, or two clusters), a message to `mm-front-desk` fails with "2 agents are named 'mm-front-desk'". Architects nudge the front desk after every item they raise, so with clusters this breaks routinely. (It already happened on this PC tonight.)

After this task:
- The main team's front desk stays `mm-front-desk` (nothing changes for it).
- A cluster front desk is named `mm-front-desk-<slug of the cluster folder's name>`, e.g. folder `C:\work\Team (Alpha) one` → `mm-front-desk-team-alpha-one` (use the existing `sessionName`/slug rule in `src/launch/command.ts`). Same name for the Windows Terminal tab title, `claude -n`, and `--remote-control`.
- The front desk records that name in its roster, so every nudge the roster hands out (`raise_item`'s `nudge.to`, etc.) names the right front desk.

## How
- `src/launch/front-desk-launch.ts`: derive the name from the cluster folder; put it in the tab title, `-n` and `--remote-control`; also set `MM_FRONT_DESK_NAME` in the tab script (main team: leave it unset, and clear any inherited one, like the other inherited variables).
- `src/roster/tools.ts` `start_front_desk`: when no `name` argument is given, use `MM_FRONT_DESK_NAME` from the roster server's environment (the server inherits the front desk's environment), else `mm-front-desk`. Make this a small tested function.
- `commands/front-desk.md` step 1 and `briefings/architect.md` line 5: wording so they stay true (the front desk's name comes from `list_sessions`; never assume `mm-front-desk`). Keep `test/briefings.test.ts` passing (size caps).

## Tests first
- `test/front-desk-launch.test.ts`: cluster → name `mm-front-desk-<slug>` in title, `-n`, `--remote-control` and `MM_FRONT_DESK_NAME`; main team → `mm-front-desk`, no `MM_FRONT_DESK_NAME`, and an inherited one is cleared; two folders → two names.
- A roster test: `start_front_desk` with no name uses `MM_FRONT_DESK_NAME` when set, `mm-front-desk` otherwise; an explicit `name` still wins; a nudge to the front desk then names it.

## Files expected to change
`src/launch/front-desk-launch.ts`, `src/roster/tools.ts` (start_front_desk only) or a helper in `src/roster/sessions.ts`, `commands/front-desk.md`, `briefings/architect.md`, the tests above.

## Out of scope
- Architect and developer names (they are per project; two clusters with the same project name could still collide; record it as a gap, do not fix).
- The picker pop-up itself, README beyond one line if needed.
- Do not open a real front desk, do not touch the live roster database (`%USERPROFILE%\.claude\multi-manager\roster.db`), do not message or stop any running session.

## Test scope
- `node --test test/front-desk-launch.test.ts` plus the roster test file you use, `test/server.test.ts`, `test/briefings.test.ts`.
- `npm run typecheck`, `npm run lint`, `claude plugin validate .`. Not the full suite.

## Evidence required
Each command with its summary lines pasted verbatim.

## Addendum (2026-10-23, before return)
The user's desktop has a "Multi-Manager Front Desk (phone)" shortcut that runs `front-desk.bat remote`. The new bat ignores the argument, so the pop-up opens with the phone box unticked. Make `front-desk.bat remote` pass a switch to `front-desk-picker.ps1` that pre-ticks "Reachable from my phone" (the user can still untick it). Without the argument, behaviour is unchanged (remembered choice). PowerShell parse check on the picker; no test harness needed beyond that. Files: `front-desk.bat`, `front-desk-picker.ps1`.

## Addendum 2 (2026-10-23, from the outside review)
Picking a drive root as the cluster folder (`D:\`) fails: Windows PowerShell 5.1 passes `"D:\"` to node, which reads it as `D:"`, so the user sees "The folder does not exist: D:". In `front-desk-picker.ps1`, pass a folder that survives (e.g. trim a trailing backslash and, for a bare drive, pass `D:\.`), and keep the remembered folder as the user typed it. Check it with the stand-in node driver.
