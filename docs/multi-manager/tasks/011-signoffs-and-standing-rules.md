# 011 — Sign-offs go straight to the user's desk; standing rules held once per project

Goal #89 (workstream `pm-role`, branch `main`). Waits for task 010. Developer branch: filled in at dispatch. Return report: `docs/multi-manager/tasks/011-signoffs-and-standing-rules.return.md` on your branch.

## Goal
Two things the project manager does by hand today become the roster's job:
1. **The sign-off relay.** Today an architect's sign-off goes to its project manager, which re-raises it to the front desk, waits, copies the user's answer back word for word, and closes its own copy. Every hop is a chance to paraphrase or lose an answer. After this task, an architect's `signoff` and `question` go straight to the front desk, and the project manager watches them (sees them and their answers) without relaying. `done`, `blocked` and `info` still go to the project manager, which acts on them (stops finished architects, sorts blockers).
2. **Standing user rules.** Today the user's standing rules (no production deploy without the user's go, push after each merge, close tabs only by process id, …) are re-pasted into every goal text. After this task they are stored once per project and every session in that project (project manager, architects, developers) is shown them, word for word, at start-up.

Plus the small tool annoyances the project manager hit in practice (roster session #286's note in goal #89).

## Decisions already made (do not reopen)
- Routing rule, in `raiseItem` (`src/roster/items.ts:41-60`): when no `addressed_to` is given, the raiser is an architect, the raiser's parent is a running `project-manager`, and the kind is `signoff` or `question`: address it to the front desk and record the project manager as its watcher. Every other case is unchanged (default = parent, else front desk). An explicit `addressed_to` always wins.
- Watching: a new nullable `items.watched_by` column (session id). `list_items` for a session includes items it watches (flagged `watching: true`), with the same state filters; `mine_only` keeps meaning "addressed to me or watched by me". Watching never lets the watcher answer: `answer_item` stays front-desk only as today. When the front desk answers, the answer still goes back to the raiser (`answerItem`, `items.ts:74-80`), and the watched copy shows the answer to the project manager. `raise_item`'s reply carries a nudge for the front desk and, when watched, a second nudge for the project manager.
- Standing rules: a new nullable `projects.standing_rules` TEXT column, stored exactly as given (no trimming, like answers). New tool `set_project_rules` (project name + text; empty text clears): allowed for the front desk and for that project's running project manager; anyone else refused with a plain message. `list_projects` returns the field. `add_project` takes an optional `standing_rules`.
- Start-up: the SessionStart hook (`src/hooks/session-start.ts`) appends, for any session whose project has rules: `Standing user rules for <project> (verbatim, they apply to all your work):` followed by the text. The front desk gets nothing extra (it spans projects; it reads `list_projects`).

## Tests first
Write these first and see each fail (`test/items.test.ts`, `test/projects.test.ts`, `test/session-start-hook.test.ts`, `test/db.test.ts`):
1. Architect under a running project manager raises a `signoff` without `addressed_to` → `addressed_to` = front desk, `watched_by` = project manager. Same for `question`. `done`, `blocked`, `info` → project manager, no watcher. Architect under the front desk → unchanged. Project manager stopped → front desk, no watcher. Developer → its architect, as today. Explicit `addressed_to` wins in every case.
2. `list_items` as the project manager returns the watched sign-off flagged `watching: true`; after the front desk answers, it returns it with the answer (state `answered`). `answer_item` by the project manager is refused.
3. `raise_item` reply for a watched item contains both nudges.
4. Migration adds `items.watched_by` and `projects.standing_rules` to an old database; existing rows keep `null`.
5. `set_project_rules`: front desk sets, project's project manager sets, an architect is refused, another project's project manager is refused; text stored byte-for-byte (leading/trailing spaces and newlines kept); empty clears. `list_projects` shows it. `add_project` with `standing_rules` stores it.
6. SessionStart hook: an architect, a developer and a project manager of a project with rules each get the rules block verbatim; a project with no rules adds nothing; the front desk gets nothing extra.
7. Tool annoyances (each with a test): `list_workstreams` accepts the project's name or its numeric id; `stop_architect` accepts a `session_id` as an alternative to project + workstream; `mark_seen` accepts a single `item_id` as well as `item_ids`; `raise_item` called with `text` and no `body` fails with a message that says to use `body`.

## Files expected to change
`src/roster/items.ts`, `src/roster/projects.ts`, `src/roster/db.ts` (two `ADDED_COLUMNS` entries), `src/roster/tools.ts` (`raise_item` nudges, `list_items`, `set_project_rules`, `add_project`, `list_projects`, `list_workstreams`, `stop_architect`, `mark_seen`), `src/hooks/session-start.ts`, the tests above. `claim` `src/roster/tools.ts`, `src/roster/db.ts`, `src/roster/items.ts` before editing; release after your return.

## Out of scope
The Stop hook's item list, `status.ts`, `hooks/` (task 012). Briefing and skill text (task 013 tells each role about watching and standing rules). Writing rules for any real project: the front desk does that after merge. Reloading the roster server or plugin; opening the live database for writing. Pushing.

## Test scope
`node --test test/items.test.ts test/projects.test.ts test/session-start-hook.test.ts test/db.test.ts` plus any test file that covers a tool you changed (`grep -ln "list_workstreams\|stop_architect\|mark_seen\|raise_item" test/`), then `npm run typecheck`, `npm run lint`. No full suite.

## Evidence required
Pass/fail summary line of each focused run, typecheck and lint. The SessionStart hook output text for an architect in a project with rules (paste it). The `raise_item` reply JSON for a watched sign-off (paste it).
