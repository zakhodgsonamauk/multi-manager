# 015 — Stopping an old "pm" architect hands its architects to the real project manager

Goal #98 (workstream pm-handover). Branch: `worktree-mm-multi-manager-pm-handover-dev-015-pm-handover`. Return report: `docs/multi-manager/tasks/015-pm-handover-on-stop.return.md` on that branch.

## Goal
Three projects still run an old-style project manager: an architect on the `pm` workstream that launched other architects (financial-portal #173 with #298 and #301 under it, multi-manager #286 with #304 under it). Goal #89 made "project manager" a real role. The front desk wants to switch: launch the real project manager (`launch_project_manager`, already allowed beside the old one), then stop the old pm architect. Today `stop_architect` stops every child first (`src/launch/launcher.ts:304-322`, `stopSession`), so the architects mid-build die with it.

Wanted: when `stop_architect` stops an architect that has running architects under it, and the project has a running real project manager, those architects (with their developers) move under the project manager and keep running. Only the old pm's own tab (and its own developers, if any) closes. If no real project manager is running, `stop_architect` refuses with a plain message and stops nothing.

## Design (decided by the architect, see `docs/multi-manager/pm-handover/decisions.md`)
1. In `stopArchitect` (`src/launch/launcher.ts:332`), after finding the architect and before `stopSession`:
   - `handed = runningChildren(db, architect.id).filter(c => c.role === 'architect')`.
   - If `handed` is empty: today's behaviour, unchanged.
   - Else `manager = runningProjectManager(db, architect.project_id)`.
     - None: throw. The message must lead with the point, because the sidebar's pop-up shows only the first 120 characters (`hooks/register.tsx:194`). Suggested: `Not stopped: <name> has <N> architect(s) running under it and <project> has no project manager to take them. Launch it first (launch_project_manager), or stop those architects first: <names>.`
     - Found: in one transaction, set `parent_id = manager.id` for each handed architect, and re-route their live items (below). Then `stopSession(architect.id)` as today: its remaining running children (developers) still stop first.
   - Do NOT put this in `stopSession`: pause (`src/roster/tools-pause.ts:148-153`), `stop_project_manager`, `stop_developer` and idle-stop call `stopSession` and must keep stopping everything.
2. Items. Live items (state open or answered) that a handed architect raised and that are addressed to or watched by the old pm are re-routed as if raised now under the new parent:
   - `signoff` / `question` still `open`: `addressed_to` = front desk, `watched_by` = project manager (same rule as `defaultRoute` in `src/roster/items.ts:54`; reuse it, do not copy it).
   - other open kinds (`done`, `blocked`, `info`): `addressed_to` = project manager.
   - `answered` items are already addressed to their raiser (`answerItem` hands them back); only fix `watched_by` if it names the old pm.
   - `seen` resets to 0 on any item whose addressee changed.
   - Put the re-routing in `src/roster/items.ts` as a small exported function (for example `rerouteItems(db, fromSessionId, raisers, now)`), tested on its own.
3. The `StopResult` for a hand-over gains (only when something moved; keep other results unchanged):
   - `handed_over: { to: { session_id, name }, architects: { session_id, name }[], items: number[] }`
   - `next`: one plain line the caller acts on, for example `Tell <pm name> it now manages <names> (SendMessage "check list_sessions: you now manage <names>"), and tell each moved architect its project manager is now <pm name>.` Give the exact session names so the caller can copy them.
4. Tool text: update the `stop_architect` description in `src/roster/tools.ts:461` to say an architect with architects under it hands them to the project's running project manager, and refuses if there is none.
5. `launch_project_manager` does not adopt anything at launch (decision logged: the old pm keeps coordinating until it is stopped, so there is one clean switch point and items do not move twice).

## Tests first
In `test/pm-handover.test.ts` (new; copy the roster and fake-launch setup from `test/pm-role.test.ts` / `test/launcher.test.ts`; temp database, fake process deps, nothing real launched or killed):
1. Old pm architect with two running architects (one with a running developer) and its own running developer; project manager running: stop the old pm. Asserts: the old pm and its own developer are stopped and their kill commands ran; both architects and the grandchild developer still `running`; both architects' `parent_id` is the project manager; `handed_over` lists them; nothing of theirs was killed.
2. Same, but no project manager running: `stop_architect` throws, the message starts with `Not stopped:` and names the architects; nothing is stopped or killed; parents unchanged.
3. Project manager of a different project running: still refuses (only the same project counts).
4. Architect with only developers under it: unchanged behaviour (developers stopped first), no `handed_over` in the result. (The existing test at `test/launcher.test.ts:206` covers part of this; keep it passing.)
5. Items: a handed architect's open `done` to the old pm moves to the project manager and becomes unseen; its open `signoff` to the old pm moves to the front desk with the project manager watching; an `answered` item keeps its addressee; an item the old pm raised itself is not touched; another architect's item is not touched.
6. After the hand-over, a new `raiseItem` from a moved architect routes by the new parent: `done` to the project manager, `signoff` to the front desk watched by the project manager.
7. Pause still stops everything: an old pm with an architect under it and a running project manager; `pause` stops all three (no hand-over during pause). Use the existing pause test setup in `test/pause.test.ts` if simpler.
8. By `session_id` and by project/workstream both hand over.

## Files expected to change
- `src/launch/launcher.ts` (`stopArchitect`, `StopResult` type)
- `src/roster/items.ts` (re-route function)
- `src/roster/tools.ts` (`stop_architect` description only)
- `test/pm-handover.test.ts` (new)
- `briefings/front-desk.md`: one short line on switching an old-style project manager: launch the real project manager, then `stop_architect` the old pm architect; its architects move across; send the `next` nudges.
- `briefings/project-manager.md`: one line: architects may be handed to you mid-goal; read their goals and `status.md` with `get_goal` and `list_sessions`, then carry on.
- `docs/` user-facing doc that describes `stop_architect`, if one does (grep for it; `README.md`, `docs/*.md`). Wording only.

## Out of scope
- `stopSession`, pause, resume, restore_all, idle-stop, `stop_project_manager`.
- A new tool, a new opt-in switch, a pane button, or changing the pane's pop-up text.
- Re-addressing goals or workstreams. Moving the old pm's own items.
- Restarting, reloading or calling any live roster server. Never stop or touch real sessions (#173, #286, #298, #301, #304 and others are live). Throwaway roster only.

## Test scope
- `node --test test/pm-handover.test.ts test/launcher.test.ts test/items.test.ts test/pm-role.test.ts test/pause.test.ts test/briefings.test.ts`
- `npm run typecheck`, `npm run lint`
- Never the full suite.

## Evidence required
Return report with: files changed in plain words, each command exactly as run with its summary lines pasted, decisions made, gaps.
