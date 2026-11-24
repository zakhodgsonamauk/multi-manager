# 028 — Cheaper helper agents, Fable and nudges

Goal #2. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/028-cheaper-helpers-and-nudges.return.md` on that branch.

## Goal
Measured over the last 14 days (estimates at list prices):
- Helper agents were 13.8% of usage, about two thirds of it started by architects.
- Fable was 9.3% of usage from 2% of calls; architects account for about half of that.
- Turns started by messages from another session were 41%. That includes real work, but "check roster item #N" nudges alone were about $1.8k of architect turns. Each nudge to an idle manager is a full re-read of its conversation.

After this task:
- The architect and project-manager briefings tell them to run read-only research and search helpers on Sonnet, or Haiku for plain searching, by passing the model on the Agent tool. Opus is only for reviews that need judgement.
- Fable is kept for the single hardest decision, and is logged.
- Nudges are cut where the receiver has nothing to do. A project manager that only watches an item gets no `watcher_nudge` for kinds it never acts on (sign-offs and questions go to the front desk). Duplicate nudges for the same item to the same session are dropped.
- Developers report progress to their architect only through `done` and `blocked`, not running commentary.

## Tests first
- `raise_item` returns no `watcher_nudge` for a sign-off or question when the watcher is a project manager. It still returns one for `done` and `blocked`.
- A second nudge for the same item to the same session within its open life is recorded as a duplicate and not sent. Pick the cleanest place: the roster's `record_nudge`, or the code that builds the nudge text.
- Briefings test: the architect and project-manager briefings name a cheaper model for research helpers, and the developer briefing says to report only via `done` and `blocked`.

## Files expected to change
- `src/roster/items.ts` and `src/roster/tools.ts` (the `raise_item` reply)
- `briefings/architect.md`, `briefings/project-manager.md`, `briefings/developer.md`
- `commands/dispatch.md`, `commands/review-return.md`, `commands/plan-goal.md` (helper-agent model lines)
- tests

NOTE: `briefings/architect.md`, `briefings/developer.md` and `commands/plan-goal.md` currently have uncommitted edits in the project folder that belong to someone else. Start only after those are committed or settled, and do not overwrite them.

## Out of scope
- The check-in timer (task 026).
- Restarts (task 027).
- Start-up plugins (task 029).

## Test scope
`node --test test/items.test.ts test/briefings.test.ts test/signoff-tools.test.ts` and any new tests, then `npm run typecheck` and `npm run lint`. Never run the full suite.

## Evidence required
Test summary lines. The changed briefing lines quoted in the return report.
