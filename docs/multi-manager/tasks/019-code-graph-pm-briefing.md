# 019 — Project manager instructions for code-review-graph

Goal #102. Needs 016 merged; can run alongside 017. Branch: `worktree-mm-multi-manager-graph-watcher-dev-019-code-graph-pm-briefing`. Return report: `docs/multi-manager/tasks/019-code-graph-pm-briefing.return.md` on that branch.

## Goal
The project manager knows it owns its project's code-review-graph switch and when to use it.

## Tests first
In `test/briefings.test.ts`, the project-manager briefing must:
- mention `set_code_graph`;
- say it is off unless the project's teams will search a large codebase;
- say the project manager decides and logs the decision.

The front-desk briefing must mention that the front desk may also switch it.

## Files expected to change
- `briefings/project-manager.md`: a short "Code search tool" section, at most 6 lines. It covers:
  - what the tool is, in one line;
  - its cost: about 0.57 GB per open tab in an "on" project;
  - when to switch it on;
  - that the watcher and stale data are handled automatically;
  - that the decision goes in `decisions.md`.
- `briefings/front-desk.md`: one line.
- `commands/pm-intake.md`: when a new project gets its first workstream, decide the switch. Default off.
- `test/briefings.test.ts`.

## Out of scope
- Code changes.
- Other briefings.

## Test scope
`node --test test/briefings.test.ts`, then lint. Never the full suite.

## Evidence required
- The test summary line.
- The new briefing text, quoted in the return report.
