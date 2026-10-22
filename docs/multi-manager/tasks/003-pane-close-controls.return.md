# 003 — return report (round 1)

Branch: `worktree-mm-multi-manager-main-dev-003-pane-close`. Last code commit before this report: the pane commit, then `git merge main` (main had only task 001's docs at that point, no code).

## What changed
- **Answering a stopped raiser tells nobody.** `answer_item` still records the answer exactly as typed, but when the item's new addressee is not a running session it returns `nudge: null` and a plain `note` ("Answer saved. mm-x is stopped, so nobody was told."). Running raisers get the same nudge as before. The rule lives in `answerReply` (`src/roster/items.ts`); the tool handler in `tools.ts` just spreads it.
- **Status says whether each waiting item's raiser is running** (`raised_by_running` on every item row, `src/roster/status.ts`).
- **Hiding.** `archived_at TEXT` on `projects` and `workstreams`, added through `ADDED_COLUMNS`, so an existing roster gains them on open. `setWorkstreamArchived` / `setProjectArchived` in `projects.ts` hide or show again, and refuse to hide while an architect for that scope runs ("mm-x is still running for shop/main: stop it first, then hide it."). `status` skips hidden ones. `list_projects` / `list_workstreams` still return them, with the flag set.
- **New tools** `archive_workstream { project, workstream, archived }` and `archive_project { project, archived }` in the new `src/roster/tools-tidy.ts`. `tools.ts` changes: one import, one register line, and the `answer_item` handler and description.
- **Pane** (`hooks/register.tsx`, `hooks/roster-view.ts`, `types/index.d.ts`):
  - every waiting item has **Close** → "Close #N without answering?" **Yes, close** / **Cancel**. It calls `close_item` only. No message is sent and no prompt is queued.
  - items from a stopped raiser read `from mm-x (stopped)`.
  - an answer that comes back with `nudge: null` shows the roster's note as a pop-up message. Nothing is sent and nothing is queued.
  - each goal has **Close** → "Close goal #N?" **Done** / **Cancelled** / **Keep** (`update_goal`).
  - a workstream with no architect running has **Hide** (two-step). A project where no workstream has an architect has **Hide project** (two-step). If the roster refuses, the pane shows its words.
- **Front desk briefing**: the answer line now says to send the returned nudge, or tell the user the note when it is null. A new tidying line names `close_item`, `archive_workstream` and `archive_project`.
- `test/server.test.ts` tool list gains the two new tools.

## Tests run
Tests were written first. The roster tests were run red first: the raiser-state assertion failed with `actual: [ [ 'mm-alpha-main', undefined ], [ 'mm-alpha-ui', undefined ] ]`. The pane tests could not be run red, because this copy of the code first lacked the generated plugin types (see Gaps). They were written before the pane code and use button keys that did not exist before.

After `git merge main`:

`node --test test/items.test.ts test/archive.test.ts test/status.test.ts test/server.test.ts test/db.test.ts test/projects.test.ts`
```
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`node --test test/briefings.test.ts`
```
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Neighbouring roster tests that read projects and sessions: `node --test test/schema-model.test.ts test/health.test.ts test/recovery.test.ts test/tools-monitor.test.ts`
```
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

`npm run typecheck`
```
> multi-manager@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
```
(no errors)

`npm run lint`
```
> multi-manager@0.1.0 lint
> eslint .
```
(no problems)

`npm run check:mod`
```
✔ Validation passed
...
(pass) Close on a waiting item asks first, then closes it without answering or telling anyone [76.89ms]
(pass) an item whose raiser has stopped is labelled, and answering it tells nobody [56.06ms]
(pass) a running raiser is not labelled stopped [45.78ms]
(pass) Close on a goal offers Done, Cancelled and Keep [69.15ms]
(pass) Hide shows only where no architect runs, asks first, and calls the hiding tools [76.55ms]
(pass) a refused hide says why [51.57ms]

 19 pass
 0 fail
Ran 19 tests across 1 file. [1.12s]
```

## Screenshots (opened and judged)
- None. As the task says, the architect does the click-through in a throwaway cluster front desk after merge.

## Decisions made
Both are logged in `docs/multi-manager/decisions.md`:
- A hidden workstream or project with a running architect shows again in `status`, so a running architect never vanishes from the pane. This can only happen if one is launched into a hidden workstream later, because the launcher (task 001's file) does not un-hide.
- The "nobody to tell" rule: nudge only when the new addressee is on the roster and running. An item with no raiser still goes back to the front desk as before.

## Gaps
- **Possible merge conflict with task 001:** `src/roster/tools.ts` and `test/server.test.ts` are claimed by developer #47 (task 001). The task file sanctioned my edits there, and I kept them minimal: import + register line + `answer_item` handler in `tools.ts`, two names in the tool list in `server.test.ts`. Task 001's code was not yet on main when I merged, so expect small conflicts in those two spots if 001 merges first.
- **Local setup:** to run `npm run check:mod` here, I copied the generated plugin types folder (`.claude-plugin/types`, ignored by git) from the project folder into this copy, and linked `node_modules` to the project folder's (also ignored by git). Neither is committed.
- **Showing hidden things again:** there is no pane button for this. The user asks the front desk (`archived: false`), as the pane's pop-up message says.
- **The new-item pop-up** ("New done report from …") does not add "(stopped)". Only the item heading in the pane does.
