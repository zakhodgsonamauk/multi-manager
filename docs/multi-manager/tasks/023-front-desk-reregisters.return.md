# 023 — return report (round 1)

Branch: `worktree-mm-multi-manager-front-desk-items-dev-023-fd-reregister`. Last commit: `1b1f9a7`.

## What changed
- After a roster server restart, the front desk is recognised again on its own. No `start_front_desk` needed.
  The server checks its parent Claude Code process's session file. If its `name` matches the front-desk record, the session is the front desk.
- Only when the environment gives no identity. Architects, project managers and developers are untouched.
- Recognition only updates the front desk's last check-in. Name, state and everything else stay as they were.
- The monitor's front-desk check now turns on once recognised. It retries at most every 30 s while unrecognised.
- Files: new `src/roster/identity.ts`; `src/roster/tools.ts` (identity read through `currentIdentity`); `src/roster/server.ts`;
  the tool files that read identity (`tools-health`, `tools-monitor`, `tools-pause`, `tools-recovery`, `tools-voice`); new test file.

## Tests run
- `node --test test/front-desk-recognise.test.ts` — `ℹ tests 10`, `ℹ pass 10`, `ℹ fail 0`
- `node --test test/front-desk-recognise.test.ts test/server.test.ts test/front-desk-start.test.ts test/tools-monitor.test.ts test/monitor.test.ts` — `ℹ tests 24`, `ℹ pass 24`, `ℹ fail 0`, `ℹ duration_ms 712.1985`
- `npm run typecheck` — clean (no errors)
- `npm run lint` — clean (no output)

## Screenshots (opened and judged)
None. No UI changed.

## Decisions made
- Logged in `docs/multi-manager/decisions.md` (Task 023 entry).

## Gaps
- Not tested live: the real roster server started under a real Claude Code session. The tests use a fake session file and a fake parent process id.
- Non-front-desk session with no environment identity (e.g. a plain Claude Code window that never ran the roster): its parent's session file name will not match the front-desk record, so it stays unregistered with the same message as before. Covered by the tests (names `mm-multi-manager-x`, no name, unreadable file).
