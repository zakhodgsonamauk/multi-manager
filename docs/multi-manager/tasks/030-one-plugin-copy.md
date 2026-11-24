# 030 — Use only the C:\dev copy of Multi-Manager

Goal #2. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/030-one-plugin-copy.return.md` on that branch.

## The user's answer (sign-off item #2, Q4)
The question was: "Which plugin copy runs: some front desks (and this project's manager and architect) run the Dropbox copy, others run C:\dev. The code is identical today. Make C:\dev the only copy used? [yes]"

The user answered: "go on all as recommended".

## Goal
Multi-Manager is not installed through the plugin marketplace. Each session loads it with `--plugin-dir` from whichever copy its front desk was started from (`src/roster/server.ts:11`):
- `mm-front-desk-dev` and the Nuclear Option sessions run `C:\dev\multi-manager`.
- The opendrift-master and projects front desks, and their architects and project managers, run `I:\Dropbox (Personal)\Projects\multi-manager`.

The Dropbox copy is old and stale. Two copies mean fixes from this goal would reach only half the sessions.

After this task, every way of starting a front desk points at `C:\dev\multi-manager`. Starting from any other copy shows a clear one-line warning naming the right folder.

## Steps
1. Find every launcher that starts a front desk from the Dropbox copy:
   - Windows Terminal profiles (see `src/launch/terminal-profile.ts`, and the user's Terminal settings, read-only first);
   - desktop and Start menu shortcuts;
   - `front-desk.bat` and `front-desk-picker.ps1` callers;
   - scheduled tasks, if any.
   List them in the return report before changing anything.
2. Point each one at `C:\dev\multi-manager`. Keep a backup of any user settings file you change, next to it, as `<name>.bak-030`.
3. Check where each cluster's roster database lives. It should be the cluster folder's `.multi-manager\roster.db`, not the plugin folder. Make sure switching copies does not orphan a roster. If a roster lives inside the Dropbox plugin copy, stop and report it; do not move it.
4. Add the warning: when the roster server or the front-desk launcher runs from a folder other than the canonical one, it says so once. Where the canonical folder is recorded is your choice, for example a small setting. Never hard-code a path in shared code without a test.
5. Do NOT restart or close any running front desk or session. The switch takes effect on their next start. The user decides when.

## Tests first
- The launcher warning: running from a non-canonical folder produces the one-line warning; running from the canonical one produces none.
- `terminal-profile.ts` (if it writes profiles) writes the canonical plugin folder.

## Files expected to change
- `src/launch/terminal-profile.ts`
- `src/launch/front-desk-launch.ts`
- `src/roster/server.ts` (the warning)
- `front-desk.bat` / `front-desk-picker.ps1` if needed
- the user's Terminal settings and shortcuts outside the repo, with backups
- tests

NOTE: `src/launch/launcher.ts` and `test/launcher.test.ts` have someone else's unsaved edits in the project folder. Do not edit them. If you need to, stop and report.

## Out of scope
- Deleting or changing the Dropbox copy itself.
- Restarting sessions.
- The roster's contents.

## Test scope
`node --test test/front-desk-launch.test.ts test/terminal-profile.test.ts test/server.test.ts` plus new tests, then `npm run typecheck` and `npm run lint`. Never run the full suite.

## Evidence required
- Test summary lines.
- The list of launchers found and changed, each with the before and after path.
- Where each cluster's roster lives.
