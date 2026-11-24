# 034 — Switch a running session to a backup and back, keeping its conversation

Goal #4. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/034-switch-session-backend.return.md` on that branch.
Waits for: task 033 merged, and goal #2's task 027 merged (it changes the restart/resume path).

## Goal
A session that has run out of Claude usage can be moved to a backup without losing where it was, and moved back to Claude later.

- New roster tool `set_session_backend(session_id, backend)`: close the tab, relaunch with `--resume <conversation id>` on the new backend, same roster row, same model tier. Model it on the existing `changeSessionModel` path (`src/launch/launcher.ts`), which already does this for a model change.
- Works for developers too. Today `restart_developer` starts a fresh conversation; this switch must resume instead.
- Readiness check first; not ready means nothing is closed.
- Record each switch in the model ledger (`claude:opus` to `box:opus` style, with a reason).
- Batch form: `session_ids: "all"` (every live session on `claude`) for the "usage ran out" case in 035. The user said every role may go on a backup (sign-off #13, Q3: "all"), so this includes the front desk and project managers. Switch the front desk last, after the others, because its window hosts the side pane. If the front desk cannot be relaunched by Multi-Manager with its conversation kept, report that before building around it.
- First check, by hand, that a conversation started on Claude resumes cleanly on a backup and back (the transcript is kept locally, so it should). Report what you find before building on it. If a backend cannot take a long conversation (bigger than its context limit), fall back to a fresh start with the task re-sent, and say so in the tool result.

## Tests first
In `test/switch-backend.test.ts`: switch closes the old tab and relaunches with `--resume` and the new backend's env; not-ready leaves the tab alone; ledger row written; batch form switches every role, the front desk last, and skips sessions already on a backup; developer switch resumes rather than starting fresh; too-big conversation falls back to a fresh start with the task.

## Files expected to change
`src/launch/launcher.ts`, `src/roster/tools.ts` (or a sibling tools file), `src/roster/model-ledger.ts` if needed, `briefings/front-desk.md` (one paragraph: how to switch sessions), tests.

## Out of scope
Detecting usage ran out (035), the pane (036).

## Test scope
The new test file, the existing `test/change-model.test.ts` and `test/launcher.test.ts`, typecheck, eslint on changed files.

## Evidence required
Test summary lines. A real switch of one throwaway developer session Claude to backup to Claude, with screenshots of the resumed tab showing it remembers the earlier exchange. Ask the architect before opening the tab.
