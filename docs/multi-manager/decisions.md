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

## 2026-10-23 — A hidden workstream or project with a running architect shows again (task 003)

- Context: hiding is refused while an architect runs, but an architect can still be launched into a hidden workstream later (the launcher is task 001's file, so it does not un-hide).
- Decision: `status` skips a hidden workstream only while no architect runs there, and a hidden project only while none of its shown workstreams has one. A running architect is never hidden from the user; the flag stays set and drops it again once the architect stops.
- Alternatives: un-hide on launch (touches the launcher, out of scope); hide regardless (a running architect could vanish from the pane, with no Stop button).
- Who: the developer.

## 2026-10-23 — answer_item's "nobody to tell" rule (task 003)

- Context: answering an item whose raiser had stopped produced a nudge to a dead session.
- Decision: the nudge goes to the item's new addressee only if that session is on the roster and running. Otherwise `nudge: null` with a plain `note` ("Answer saved. mm-x is stopped, so nobody was told."). An item with no raiser still goes back to its addressee (the front desk), as before. The logic lives in `answerReply` in items.ts so it is tested without the tool server.
- Who: the developer.
## 2026-10-23 — Front desk picker details (task 002)

- Context: task 002 left the picker's detail to the developer.
- Decision:
  - OK only closes the pop-up once the folder exists (a bad path shows a message and keeps the pop-up open); the result is read from the form's DialogResult, so no click-handler variable is involved. Enter is OK, Esc is Cancel.
  - A pasted path wrapped in quotes (Explorer's "Copy as path") is accepted.
  - The last folder is remembered only after a successful launch, in `%LOCALAPPDATA%\multi-manager\last-cluster.txt`.
  - The tab clears exactly the eight variables today's `front-desk.bat` cleared, not every `CLAUDE_CODE_*` variable as the architect wrapper does, so a user's own `CLAUDE_CODE_*` settings still reach the front desk.
  - The front desk tab does not join a kill-on-close Job or record pid/exit files like architect tabs: it is not a roster session that the launcher stops or restarts.
  - `front-desk.bat` starts the picker with `start "" powershell -WindowStyle Hidden`, so no console window stays open behind the pop-up, and strips the trailing backslash from its folder (a `"C:\path\"` argument would swallow the closing quote).
  - The runner waits for `wt.exe` to exit and treats a non-zero exit as a failure (as the architect launch does); it exits 1 with the reason on stderr (missing folder, wt.exe not found, wt.exe failed), and the picker shows that text in a message box.
- Alternatives: the plan's `$confirmed` flag (never set, because of PowerShell scope); clearing all `CLAUDE_CODE_*` (drops user settings).
- Who: developer #48.

## 2026-10-23 — Front desk picker, round 2 (task 002 send-back)

- Context: the architect's send-back asked for a way back to the main (shared) roster, and for the tab and runner to drop a managed session's identity while keeping the user's own Claude Code settings.
- Decision:
  - The pop-up has two choices: "My main team (no folder)" and "A cluster folder". The main team opens in the plugin folder with no `MM_ROSTER_DB`, as the old bat did. The remembered choice is the word `main` or the folder's absolute path (UTF-8). Nothing remembered means the main team, since that is the team already running on this PC.
  - The tab script clears `MM_ROSTER_DB` as well as the eight Claude variables and `MM_ROLE`/`MM_SESSION_ID`/`MM_PARENT_ID`/`MM_VOICE`, then sets it only for a cluster. Otherwise a picker started from a cluster session's shell would open the "main team" on that cluster. Cost: a user-set global `MM_ROSTER_DB` no longer applies to the pop-up's main team (the README says so).
  - The environment handed to `wt.exe` drops only those eight Claude variables and four `MM_*` identity variables (names compared case-insensitively, as Windows does); other `CLAUDE_CODE_*` settings pass through. Supersedes the use of `launchEnv` in the runner.
  - The runner logic moved into `src/launch/front-desk-launch.ts` (`runFrontDeskLaunch`, injected spawn) so it is unit tested; `scripts/front-desk-launch.ts` only wires it to the real spawn. `--main` and `--folder` are mutually exclusive and one is required.
  - A cluster folder gets `.multi-manager\.gitignore` containing `*` (written with `wx`, never overwritten); the folder's own `.gitignore` is never touched.
  - If only remembering the choice fails after a successful launch, the picker says nothing: the front desk did open.
- Alternatives: leave an inherited `MM_ROSTER_DB` alone for the main team (risks opening a cluster by mistake).
- Who: developer #48, from the architect's send-back round 1.
