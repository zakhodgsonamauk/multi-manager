# 023 — The front desk is recognised again after its roster server restarts

Goal #127. Branch: `worktree-mm-multi-manager-front-desk-items-dev-023-fd-reregister`. Return report: `docs/multi-manager/tasks/023-front-desk-reregisters.return.md` on that branch.

## Goal
After the user reconnected the roster tool connection (goal #124 switch-on), the front desk's first roster call failed:
"This session is not registered with the roster. Front desk: run /multi-manager:front-desk first." The front desk had
to re-run `start_front_desk`. Until it did, the background monitor in its roster server was also off (it only acts
when the identity is front desk, `src/roster/server.ts:21`): no death checks, no auto-clear, no stuck checks.

Why: architects, project managers and developers get their identity from `MM_SESSION_ID` / `MM_ROLE` in their
environment (`identityFromEnv`, `src/roster/tools.ts:74`), so a restarted server knows them at once. The front desk
tab clears those variables and only becomes the front desk in memory when `start_front_desk` runs
(`tools.ts:146`). A new server process starts with no identity.

Fix (on by default, no switch): when the environment gives no identity, the roster server recognises the front desk
by its own Claude Code process.
- The roster server's parent process is the session's `claude.exe` (checked live: `node server.ts <- claude.exe`).
  Claude Code writes `~/.claude/sessions/<pid>.json` with a `name` field; the front desk's says `mm-front-desk`
  (a cluster's `mm-front-desk-<folder>`).
- Rule: no `MM_SESSION_ID` and no `MM_ROLE` (or `MM_ROLE=front-desk`), the parent's session file `name` equals the
  roster's front-desk record name (`frontDesk(db).name`, falling back to `frontDeskNameFromEnv()`), and the record
  exists → identity `{ sessionId: desk.id, role: 'front-desk' }`. Check in the front desk (as `start_front_desk`
  does for `last_checkin_at`), but do not change its name or anything else.
- When: at server start, and again lazily whenever a tool needs an identity and has none, and in the monitor's
  `active` check (cheap: one small file read, at most once every 30 s while unrecognised). The session file may be
  written a moment after the server starts.
- Any other session (no name, another name, a session file that cannot be read) stays unregistered, exactly as
  today. Never adopt the front desk identity on a guess.
- Reuse the existing session-file reader (`realActivityReaders().readSessionFile`, `src/monitor/activity.ts:53`);
  inject it so tests use a fake.

## Tests first
New `test/front-desk-recognise.test.ts` (temporary roster, fake session-file reader, fake parent pid):
- parent session file named `mm-front-desk`, front desk record named `mm-front-desk` → identity front desk; a tool
  that needs an identity (e.g. `team_health` or `answer_item`) works without `start_front_desk`;
- cluster name: record `mm-front-desk-alpha`, `MM_FRONT_DESK_NAME=mm-front-desk-alpha`, file name matches → recognised;
- file name `mm-multi-manager-x` or missing name or unreadable file → stays unregistered; the old error message stands;
- `MM_ROLE=architect` with `MM_SESSION_ID` set → environment identity wins, file never read;
- file written after start: first check fails, a later tool call recognises it;
- monitor `active` turns true once recognised.
Existing: `test/server.test.ts`, `test/front-desk-start.test.ts`, `test/tools-monitor.test.ts` still pass.

## Files expected to change
`src/roster/tools.ts` (identity resolution), `src/roster/server.ts`, possibly a small new `src/roster/identity.ts`,
the tests above. Claim `src/roster/tools.ts` and `src/roster/server.ts` before editing; release on return.

## Out of scope
- The pane (`hooks/`), briefings, commands. The hooks' own `MM_SESSION_ID` check (`src/hooks/*`).
- Restarting or reconnecting anything live. The live roster database.

## Test scope
`node --test test/front-desk-recognise.test.ts test/server.test.ts test/front-desk-start.test.ts
test/tools-monitor.test.ts test/monitor.test.ts`, then `npm run typecheck` and `npm run lint`. Never the full suite.

## Evidence required
Test summary lines; a short note of what happens for a non-front-desk session with no environment identity.
