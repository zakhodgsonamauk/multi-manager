# Return: task 021, pane items UI

Branch `worktree-mm-multi-manager-front-desk-items-dev-021-pane-items-ui`. Touched only `hooks/register.tsx`, `hooks/roster-view.ts`, `types/index.d.ts`, `mod-test/`, and the decisions file. Nothing under `src/`.

## What changed
- Pane has two sections. "Needs your action (N)": sign-off, question, blocked, oldest first, same box/Send/Close/Approve as before, header now also shows the project. "For information (N)": done, info, newest first, one compact line each, click to open the full body, Clear per line (no confirm), Clear all (one confirm). Empty sections are not drawn; both empty gives "Nothing waiting."
- "Recently answered" (collapsed): `#N kind, project: answer (age)`, kept 24 hours in a `$.state` atom.
- Front desk hears pane actions: answers and clears (also the old Close) are queued in a `$.state` atom. A new `prompt.submit` hook (front desk only) adds one `additionalContext` entry on its next turn, then empties the queue. One dim chat line per action via `$.ui.log` ("Answered #12 from the panel.").
- Watcher nudge bug fixed: `answer()` now delivers `watcher_nudge` as well as `nudge`.
- Category uses item `kind`; uses `category` and `project` from the roster when they are present (task 020).

## Tests (all run from this branch)
`npm run test:mod`:
```
 44 pass
 0 fail
Ran 44 tests across 3 files.
```
New: `mod-test/pane-items.test.ts` (split + ordering, empty sections, category override, info line + cap, note builder: none/one answer/one clear/mixed, verbatim quoting, 24-hour pruning) and in `front-desk-pane.test.tsx`: two sections drawn, empty pane, Clear and Clear all (one confirm), both nudges delivered, one note on next turn then nothing on the second, dim log lines, Recently answered list, non-front-desk session gets no note. Two existing tests updated: header now has the project; the "stopped raiser" test uses a question (a done report is no longer answerable in the pane).

`npm run lint`: clean (no output after `> eslint .`).
`claude plugin validate .`: `✔ Validation passed`.
`npm run typecheck:mod`: three errors, all in the untouched BAND tests (`front-desk-pane.test.tsx` lines ~324, 339, 373): `Property 'isCollapsed' is missing in type ...`. Caused by the API types in `.claude-plugin/types` (gitignored; I copied the main folder's set into this temporary copy) being newer than the test's BAND props. Not from this task. No errors in the files I changed.

## Rendered pane text (two action, three info, one recent answer, #20 opened)
```
Needs your action (2)
#12 sign-off (shop) from mm-arch-shop · 5 min ago
> Plan for checkout: / > 1. Cart page / > 2. **Payment** step     [Send] [Close]
#13 question (shop) from mm-arch-shop · 1 min ago
> Which payment provider?                                          [Send] [Close]
For information (3)                                                [Clear all]
▸ #22 done report · blog · mm-arch-blog · 2 min ago · Done: blog theme        [Clear]
▸ #21 note · shop · mm-arch-shop · 4 min ago · FYI the build is slow today    [Clear]
▾ #20 done report · shop · mm-arch-shop · 15 min ago · Done: cart page        [Clear]
> Done: cart page
> second line
▾ Recently answered (1)
  #13 question, shop: Stripe (0 min ago)
Projects ...
```
(Order and labels taken from the test kit's element dump; no screenshot taken, that is the architect's job.)

## Decisions
Logged in `docs/multi-manager/front-desk-items/decisions.md` (2026-11-10 Task 021).

## Gaps
- Not judged on screen: very long info lines in a narrow pane (line is cut at 100 characters, the Clear button sits beside it; layout in a real narrow dock unverified).
- Mobile: information lines use the same buttons; no Approve/Reject for them (they are not decisions).
- Reload of the live plugin not done (out of scope).

## Round 2 (send-back round 1)
Merged main (task 020) into the branch first.
1. Notes lost: the hook now empties the queue only after `next` returns without a drop, and removes only the notes it attached. A drop or a throw keeps the queue. Chosen: an `isMeta` prompt and a slash-command prompt (`e.command`) pass untouched and the notes wait for the next real turn.
2. `buildView` maps raiser/stopped from `waiting_for_user`, `needs_action` and `for_information`, so info lines keep raiser and project on the 020 server.
3. Clear all carries on past failures; "already closed/cleared" counts as success; one pop-up "Could not clear N of M: <reason>" when any fail.
4. Recently answered uses `kindWord` ("sign-off").
5. `expandedInfo` is pruned to ids still in the view on each poll.
6. Info line capped at 70 characters and the Clear button now sits first, so it always stays visible.
7. Tests added: dropped prompt, throwing `next`, `isMeta`, slash command keep the queue; the gate test queues a note first, then makes the session an architect (role gate added to the hook, so architects and developers never get notes); Clear all with one refused and one already-closed `close_item`; 020-shaped status; 70-char cap.

`npm run test:mod`: ` 47 pass` / ` 0 fail`. `npm run lint`: clean. `npm run typecheck:mod`: only the same 3 old BAND-test errors (`isCollapsed`). Not re-run: `claude plugin validate .` (no manifest change; passed in round 1).
Gap: the gate test proves the role gate (MM_ROLE), not a cleared `isFrontDesk` flag; the test kit gives tests no way to set plugin state.
