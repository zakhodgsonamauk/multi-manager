# 011 — return report (round 1)

Branch: `worktree-mm-multi-manager-pm-role-dev-011-signoffs-rules`. Last commit: see `git log -1` on the branch.

## What changed
- **Sign-offs go straight to the front desk.** `raiseItem` (`src/roster/items.ts`): an architect whose parent is a project manager sends `signoff` and `question` to the front desk; the project manager is recorded in the new `items.watched_by`. `done`, `blocked`, `info` still go to the parent. Explicit `addressed_to` wins and sets no watcher. Developers unchanged.
- **Watching.** `list_items` (default, "mine") returns items addressed to or watched by the caller; watched ones carry `watching: true`, with the same state filters. After the front desk answers, the answer shows on the watched copy (state `answered`). `raise_item` reply carries `nudge` (front desk) and, when watched, `watcher_nudge` (project manager). `answer_item` is now refused for anyone but the front desk (before it had no check).
- **Standing rules.** New `projects.standing_rules` column, stored as given (no trim); new tool `set_project_rules` (front desk, or that project's running project manager; others get "Only the front desk or <project>'s project manager can set its standing rules"; empty text clears). `list_projects` shows the field; `add_project` takes `standing_rules`. SessionStart hook appends `Standing user rules for <project> (verbatim, they apply to all your work):` + the text for every non-front-desk session of that project.
- **Tool annoyances.** `list_workstreams` takes a name or numeric id; `stop_architect` takes `session_id` as an alternative; `mark_seen` takes `item_id` or `item_ids`; `raise_item` with `text` and no `body` fails with "use `body` for the text, not `text`".
- Two `ADDED_COLUMNS` entries in `src/roster/db.ts` (old databases gain the columns on open; old rows keep null).

## Tests run
Tests written first and seen failing (new test file errored on missing tools/columns). Then:
- `node --test test/items.test.ts test/projects.test.ts test/session-start-hook.test.ts test/db.test.ts test/signoff-tools.test.ts test/launcher.test.ts test/server.test.ts test/briefings.test.ts test/front-desk-name.test.ts test/plugin-manifest.test.ts test/pm-role.test.ts` → `ℹ tests 85`, `ℹ pass 85`, `ℹ fail 0`
- Per file: items 10/10, projects 6/6, session-start-hook 4/4, db 10/10.
- `npm run typecheck` → clean (no errors).
- `npm run lint` → clean (no errors).

New tests: `test/items.test.ts` (routing, watching), `test/projects.test.ts` (rules, workstream by id), `test/session-start-hook.test.ts` (rules block), `test/db.test.ts` (migration), `test/signoff-tools.test.ts` (tool-level: nudges, `watching`, answer refusal, `set_project_rules` permissions, annoyances), `test/launcher.test.ts` (`stop_architect` by session id), `test/server.test.ts` (tool list gains `set_project_rules`).

### SessionStart output for an architect in a project with rules
```
Multi-Manager: you are roster session #2 (architect).
No open roster items are addressed to you.
Standing user rules for alpha (verbatim, they apply to all your work):
No production deploy without my go.
Push main after each merge.
```

### `raise_item` reply for a watched sign-off
```json
{
  "item": {
    "id": 1, "goal_id": null, "raised_by": 3, "kind": "signoff", "body": "Plan", "state": "open",
    "answer": null, "addressed_to": 1, "seen": 0,
    "created_at": "2026-11-03T11:42:39.901Z", "updated_at": "2026-11-03T11:42:39.901Z",
    "answered_at": null, "watched_by": 2
  },
  "nudge": { "to": "mm-front-desk", "message": "check roster item #1" },
  "watcher_nudge": { "to": "pm-alpha", "message": "check roster item #1" }
}
```
(Compacted here; the real reply is pretty-printed.)

## Screenshots (opened and judged)
None. No UI change.

## Decisions made
Logged in `docs/multi-manager/decisions.md` (2026-11-03):
- A stopped project manager: an architect's sign-off/question still goes to the front desk (it is the user's to answer) with no watcher; `done`/`blocked`/`info` keep the plain default (the parent). This is how I read "Project manager stopped → front desk, no watcher" in the task.
- `answer_item` now checks the caller is the front desk (the task said it "stays front-desk only as today", but no check existed).
- Numeric-string project refs: a name match wins over a digits-only string read as an id.

## Gaps
- Stop hook item list, `status.ts`, briefings/skill text not touched (tasks 012/013), as scoped.
- `watched_by` items are not in the Stop hook / `openItemsFor`, so the project manager only sees them by calling `list_items` (task 012).
- Live database and running roster server not touched; the new tool appears after the roster reloads.

## Round 1 (send-back)
Changed, all 8 points:
1. `answer_item`: front-desk-only check removed. Rule now: a session that only watches an item (`watched_by` it, not `addressed_to` it) is refused. Tested: watcher refused; an architect-role addressee (hand-relaying project manager) can still answer.
2. `close_item`: only the front desk, the item's current addressee or its raiser may close. A watcher is refused ("... you only watch it"); item stays open for the front desk. Tested.
3. `mark_seen`: ids the caller only watches are skipped and listed under `skipped` (with a note). Tested: after the watcher's `mark_seen`, the front desk still sees the item unseen.
4. `stop_architect` by `session_id`: refuses a session that is not running ("#N is not running"). Tested in `test/launcher.test.ts`.
5. `raise_item`: `body` is required again in the published schema; custom `text` check removed; description says the text goes in body. Test now just expects an error mentioning `body`.
6. `answer_item` reply carries `watcher_nudge` when the item has a watcher. Tested.
7. Test: `list_items` with `mine_only: false` returns every item.
8. Decisions entry moved to `docs/multi-manager/pm-role/decisions.md`; `docs/multi-manager/decisions.md` is back to the state on main.

Tests: the same 11 files as above → `ℹ tests 86`, `ℹ pass 86`, `ℹ fail 0`. `npm run typecheck` clean. `npm run lint` clean.
Note: the earlier "Decisions made" line saying `answer_item` is front-desk-only is superseded by point 1.
