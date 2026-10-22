# Decisions

One dated entry per decision, newest last. Never rewrite an old entry: add a new one that supersedes it.

## 2026-10-23 — No plan sign-off for goal #15

- Context: the project's approval rules ask for a plan sign-off, but goal #15 quotes the user: "proceed without user input as far as possible." The front desk adds "No plan sign-off needed."
- Decision: skip the sign-off item; post the plan as an info item instead.
- Alternatives: raise a sign-off anyway (contradicts the user's words).
- Who: the user (goal #15, verbatim), applied by the architect.

## 2026-10-23 — Fix the plan's broken launch-model tests rather than the code

- Context: the earlier session stopped at plan task 6 because two plan tests were wrong (architect test pre-registers a running architect, so nothing launches; temp databases never closed, so Windows cannot delete them). It was waiting for a decision.
- Decision: fix the tests (fresh project for the architect test, close every database, track every temp folder). The planned code stays.
- Alternatives: change `launchArchitect` to relaunch over a running architect (wrong: it would create duplicates).
- Who: the architect.

## 2026-10-23 — Front desk tab sets its own environment

- Context: the plan passed `MM_ROSTER_DB` as the environment of the `wt.exe` call. A running Windows Terminal does not reliably hand that to new tabs, so a cluster front desk could silently use the global roster. The current `front-desk.bat` also clears inherited Claude variables and sets `CLAUDE_CODE_NO_FLICKER=1`, which the plan dropped.
- Decision: the front desk tab runs an encoded pwsh script (same approach as architect/developer launches) that sets those variables itself.
- Alternatives: rely on wt.exe inheritance (unreliable); write a temp .bat per launch (more moving parts).
- Who: the architect.

## 2026-10-23 — Who may change a session's model

- Context: the plan's permission check let any architect change any session, and let a session relaunch itself mid-call.
- Decision: front desk may change any architect or developer; an architect only its own developers; nobody their own session through the tool; never the front desk.
- Alternatives: the plan's rule (too broad).
- Who: the architect.

## 2026-10-23 — Relaunches keep the recorded model

- Context: restart-architect, restart-developer and restore-after-reboot relaunch tabs; without the model they would fall back to the Claude default.
- Decision: every relaunch passes the session's stored model.
- Who: the architect.
