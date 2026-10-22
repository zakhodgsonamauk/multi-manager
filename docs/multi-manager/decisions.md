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

## 2026-10-23 — Pane "close" means hide, never delete (goal #17)

- Context: the user wants to close waiting items and things under Projects that are no longer needed.
- Decision: items get closed (existing close_item); goals get marked done or cancelled; workstreams and projects get an `archived_at` flag that hides them from the pane and status but keeps them in the roster and listings, and can be undone. Hiding is refused while an architect for it runs. Answering an item whose raiser is stopped records the answer and nudges nobody.
- Alternatives: deleting rows (loses history, breaks foreign keys); a single "dismiss" that answers with a canned text (still tries to nudge).
- Who: the architect.
## 2026-10-23 — Task 001 detail: how a model change relaunches a tab

- Context: task 001 (change a running tab's model) left open what happens to claims, pauses, and sessions with no recorded model.
- Decision: (1) a model change keeps the session's claims, because it continues under the same roster id with the same conversation; a crash restart still drops them. (2) Changing a running session's model is refused while its project is paused, so it cannot undo a pause; a stopped session can still have its model recorded. (3) Only haiku, sonnet and opus are accepted, also in the launcher function, not only the tool. (4) A session with no recorded model (launched before models existed) restarts on the project default, else sonnet, and that model is then recorded. (5) The model is written on the session row inside the shared launch step, so every launch path records it the same way. (6) `set_project_default_model` is front desk only, matching the front-desk briefing.
- Alternatives: release claims like a restart (the relaunched developer would think it still holds files); allow changes during a pause (would quietly restart a paused tab); keep a null model on restart (tab falls back to the Claude default, the problem this goal fixes).
- Who: developer #47 (task 001).

## 2026-10-23 — Task 001: fast-forwarded the developer branch to main before starting

- Context: the developer copy was created from an older version that lacked the task file and the code it builds on.
- Decision: on the architect's instruction, ran `git merge --ff-only main` on the developer branch before any work (no own commits existed, so nothing was mixed in).
- Who: architect #46, run by developer #47.

## 2026-10-23 — Task 001 round 2: a failed model change leaves things as they were

- Context: architect send-back round 1. A model change could relaunch over a tab it had not closed, or leave a closed tab marked with the new model.
- Decision: (1) no relaunch unless the old process was provably closed; the error gives the reason and the model is unchanged. This supersedes nothing: claims are still kept on a successful change. (2) The session's model is written only after the new tab opens, for every launch path. (3) If the relaunch fails after the close, the session is stopped, keeps its old model, its claims are released, and the error names `restart_architect` / `restart_developer`. No ledger row is written, because the tool writes it only after success. (4) Asking for the current model returns "already on <model>" with no relaunch and no ledger row. (5) After a model change a developer continues its task; an architect still waits for the user's go. (6) `restartArchitect` still ignores "nothing to kill" warnings, because a dead architect has no process, so they would only be noise.
- Who: architect #46 (send-back), detail by developer #47.

## 2026-10-23 — Task 001 round 2: read the send-back from main instead of merging main

- Context: the architect asked for `git merge main` to get the send-back round. The developer rules forbid merging, and by then the branch had its own commits.
- Decision: read the round with `git show main:<task file>` and did not merge. The architect's squash-merge brings in the rest.
- Who: developer #47.
