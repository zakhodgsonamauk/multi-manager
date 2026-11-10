# 021 — Side panel: two item sections, quick clearing, and the front desk hears pane answers

Goal #124. Branch: `worktree-mm-multi-manager-front-desk-items-dev-021-pane-items-ui`. Return report: `docs/multi-manager/tasks/021-pane-items-ui.return.md` on that branch.

## Goal
The front desk's side panel (the Multi-Manager pane, `hooks/register.tsx` + `hooks/roster-view.ts`) shows every open
item the same way: header, full quoted body, text box, Send, Close. Information-only notes take as much room as
decisions. And when the user answers from the panel, the front desk model never finds out (the answer goes to the
raiser only; the front desk sees, at best, a pop-up the model cannot read). This task fixes both, in the pane alone.

1. **Two sections**, replacing "Waiting for you (N)":
   - **Needs your action (N)**: signoff, question, blocked. Same as today (body quoted, text box, Send, Close; on
     mobile Approve/Reject), oldest first. Each header shows kind, project, who raised it and age.
   - **For information (N)**: done, info. One compact line each (kind, project, raiser, age, first line of the body,
     cut to fit), newest first. Clicking/expanding a line shows the full body. A **Clear** button per line (no
     confirm: these are info only) and one **Clear all** for the section (one confirm). Clear calls `close_item`.
   - Category comes from the item `kind` in the pane (do not depend on task 020's `category` field; use it when present).
   - An empty section is not drawn. When both are empty, one dim line: "Nothing waiting."
2. **Recently answered** (collapsed by default): the answers the user sent from the panel in the last 24 hours, each
   "#N kind, project: answer (time)". Kept in a `$.state` atom so a reload keeps it; pruned past 24 hours.
3. **The front desk hears pane actions.** When the user answers or clears an item from the panel, queue a note in a
   `$.state` atom. Register an `on('prompt.submit', …)` hook (front desk only, same gate as the pane) that, on the
   front desk's next turn of any origin, adds one `additionalContext` entry listing the queued notes and then empties
   the queue, e.g.:
   `Multi-Manager pane: since your last turn the user, from the side panel, answered item #812 (signoff, from mm-x): "go ahead" — do not answer it again; cleared item #815 (info).`
   Answers quoted verbatim. Also write one dim transcript line per action with `$.ui.log` (the user sees it, the model
   does not) so the chat shows what happened: `Answered #812 from the panel.`
4. **Watcher nudge bug.** `answer_item` returns `watcher_nudge` for items a project manager watches. The pane drops
   it (`RosterAnswerReply` in `roster-view.ts` has no field for it; `answer()` in `register.tsx` delivers only
   `nudge`). Deliver it the same way as `nudge`.

Look and feel: follow the pane's existing components and style; judge it in screenshots. Information lines must not
push the action section down: action section first, always.

## Tests first
In `mod-test/` (run by `npm run test:mod`), pure functions in `roster-view.ts` where possible:
- `buildView` splits items into action and info by kind, with the orderings above; empty sections omitted.
- The info line text: kind, project, raiser, age, first body line, length cap.
- The note builder: one answer, one clear, several mixed; answers quoted verbatim; empty queue gives no context entry.
- The recently-answered pruning drops entries older than 24 hours.
- `answer()` delivers both `nudge` and `watcher_nudge` (extend the existing pane test harness in
  `mod-test/front-desk-pane.test.tsx`).
- The `prompt.submit` hook adds the context once and empties the queue; a second turn gets nothing.

## Files expected to change
`hooks/register.tsx`, `hooks/roster-view.ts`, `types/index.d.ts`, `mod-test/*.test.tsx`. Nothing under `src/`.

## Out of scope
- Roster server code (`src/`), `commands/tick.md`, briefings: tasks 020 and 022.
- The tick / scheduled prompts (task 022 adds its own `prompt.submit` handling later; keep your hook small and
  separate so 022 can sit beside it).
- Reloading the plugin in the live front desk. Opening any terminal tab or window.

## Test scope
`npm run typecheck:mod`, `npm run test:mod`, `npm run lint`. Never the full suite.
(`npm run check:mod` also runs `claude plugin validate .`; run that once at the end.)

## Evidence required
Test summary lines. If the mod-test harness can render the pane to text, include the rendered text of a pane with
two action items, three info items and one recent answer. Screenshots of the live pane are the architect's job.

## Send-back round 1 (2026-11-10)
Task 020 is now merged on main (commit 0ceeb62): pull it in first (`git merge main` on your branch). Its `status` has
`needs_action` and `for_information` (`waiting_for_user` = `needs_action` only); `list_items` rows carry `category`;
`raised_by` is a session id number with no `project` field.
1. **Notes can be lost** — `hooks/register.tsx:330` empties the queue before `next(...)`. Empty it only after
   `next({...e, context})` returns without a drop, removing exactly the notes you attached (the queue may have grown
   meanwhile). On a throw, keep the queue. Leave `isMeta` prompts that start a turn untouched (the types say they take
   no rewrite); keep the notes for the next real turn.
2. **Info lines lose raiser and project on the 020 server** — `hooks/roster-view.ts:175` maps raiser names only from
   `status.waiting_for_user`. Also map `status.for_information` (and `needs_action`) when present, so every item gets
   raiser and project on both old and new servers.
3. **Clear all stops at the first failure** — `register.tsx:260-266`. Carry on past failures (an item auto-cleared by
   the server meanwhile is a likely one: treat "already closed" as success), then show one pop-up with how many failed.
4. **Recently answered** — `roster-view.ts:298` prints the raw kind; use `kindWord` like the headers.
5. **`expandedInfo` grows forever** — `register.tsx:451`: drop ids of items no longer in the view.
6. **Narrow pane** — `register.tsx:448`: the info line (up to 100 chars) sits beside Clear in one row. Make the line
   wrap or shrink so Clear always stays visible; cap at ~70 characters.
7. **Tests**: a dropped prompt keeps the queue; a throwing `next` keeps the queue; an `isMeta` prompt and a slash
   command prompt (`e.command`) — say what you chose for each and test it; the "not the front desk" test must queue a
   note first so it proves the gate; Clear all with one `close_item` failing; `buildView` with a 020-shaped status.
Update your return report (round 2 section) and raise done again.
