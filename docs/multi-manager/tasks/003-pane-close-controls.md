# 003 — Close controls in the front desk pane; never nudge a stopped session

Goal #17. Branch: `worktree-mm-multi-manager-main-dev-003-pane-close`. Return report: `docs/multi-manager/tasks/003-pane-close-controls.return.md` on that branch.

## Goal
The user's words (goal #17, verbatim): "we need some more controls in the pane so the user can just close "Waiting for you" or stuff under "Projects" that's no longer needed and avoida  situation like we just had".

What happened: a done report from an architect the front desk had already stopped sat under "Waiting for you". The only control was "answer", so the user typed an answer; the pane then asked the front desk to nudge the stopped architect, which failed.

After this task, in the pane (the Multi-Manager panel beside the front desk chat, `hooks/register.tsx`):
1. Every item under **Waiting for you** has a **Close** button. Two-step like the existing Stop button: "Close #N without answering?" → **Yes, close** / **Cancel**. Closing records nothing else and nudges nobody.
2. An item whose raiser is no longer running is labelled, e.g. `from mm-x (stopped)`, so the user can see that answering would reach nobody.
3. Under **Projects**:
   - each listed goal has a **Close** button → confirm row "Close goal #N?" with **Done**, **Cancelled**, **Keep**. Done/cancelled goals already drop out of the list.
   - a workstream with no architect running has a **Hide** button (two-step). Hidden workstreams no longer show.
   - a project whose workstreams are all hidden (or with no running architect at all) has a **Hide project** button (two-step). Hidden projects no longer show.
   - Hiding is refused, with a clear message, while an architect for it is running ("stop it first").
4. Answering an item whose raiser is stopped (or has no session) still records the answer exactly as typed, but sends no nudge and queues nothing for the front desk; the pane says e.g. "Answer saved. mm-x is stopped, so nobody was told."

## Roster changes (server side)
- `answer_item`: return `nudge: null` plus a plain `note` when the item's new addressee is not a running session. Keep the existing shape when it is running. Update the front desk briefing line about answer nudges if one exists, so the front desk also never sends a null nudge.
- `status`: each waiting item carries its raiser's state (running or not) so the pane can label it.
- Hiding: add `archived_at TEXT` to `workstreams` and `projects` (through the existing `ADDED_COLUMNS` migration in `src/roster/db.ts`, so an existing roster gains the columns on open). `status` and the pane skip archived ones. New tools in a **new file** `src/roster/tools-tidy.ts` registered from `tools.ts` with one line (task 001 is editing `tools.ts` at the same time; keep your edits there minimal): `archive_workstream { project, workstream, archived: boolean }` and `archive_project { project, archived: boolean }` (false un-hides). Both refuse while an architect of that scope is running. `list_projects` / `list_workstreams` still list archived ones, with the flag, so nothing is lost.
- A short line in `briefings/front-desk.md` naming the two tools and close_item, so the user can also say "hide X" in the chat. Keep `test/briefings.test.ts` passing (front desk size cap).

## Tests first
- `test/items.test.ts` (or wherever answer_item / nudge is tested; search first): answer to an item raised by a stopped session → item answered, verbatim text kept, nudge null with a note; raised by a running session → nudge as today.
- A roster test for archiving: archive refused with a running architect; archived workstream/project missing from `statusSummary`, present (flagged) in the list functions; un-archive brings it back; an old database without the columns gains them on open.
- `mod-test/front-desk-pane.test.tsx`: Close on a waiting item → `close_item` called, no message sent, no prompt queued; goal Close → Done calls `update_goal` with `done`; Hide workstream / Hide project call the new tools; an answer whose nudge is null → no send, no queued prompt, the "nobody was told" toast; stopped raiser is labelled.

## Files expected to change
- `src/roster/items.ts`, `src/roster/status.ts`, `src/roster/db.ts`, `src/roster/projects.ts`, new `src/roster/tools-tidy.ts`, one line in `src/roster/tools.ts` (plus the `answer_item` handler)
- `hooks/register.tsx`, `hooks/roster-view.ts`, `types/index.d.ts`
- `briefings/front-desk.md`
- tests above

## Out of scope
- Model routing (task 001: `src/launch/launcher.ts`, model tools) and the front-desk picker / `front-desk.bat` (task 002).
- Deleting anything from the roster. Hiding only.
- Do not touch the live roster database (`%USERPROFILE%\.claude\multi-manager\roster.db`) or any running session. Tests use temp databases and the mod test harness only.

## Before you return
`git merge main` again (task 001 may have merged into `tools.ts` meanwhile) and re-run your focused tests.

## Test scope
- The new/changed test files with `node --test <files>`.
- `npm run typecheck`, `npm run lint`, `npm run check:mod` (pane typecheck, plugin validate, pane tests).
- `node --test test/briefings.test.ts`.
- Not the full suite.

## Evidence required
- Each command with its summary lines pasted verbatim.
- The architect does the real click-through of the pane in a throwaway cluster front desk after merge; you do not need to open a front desk.
