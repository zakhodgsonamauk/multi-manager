# 022 — return report (round 1)

Branch: `worktree-mm-multi-manager-front-desk-items-dev-022-quiet-tick`.

## What changed
A front desk check-in with nothing to act on now leaves nothing in the chat: the pane drops it before the turn starts. One with news goes through with the roster's digest attached, and the front desk acts from that instead of calling `status` and `team_health`.
- `hooks/roster-view.ts`: pure `isScheduledTick`, `readDigest`, `decideTick`, `lastCheckText`, `bandLine`, `digestContext`.
- `hooks/register.tsx`: `handleTick`, called from the one `prompt.submit` handler (the engine refuses a second unmatched one). Asks `front_desk_digest` (with `since` = time of the last tick let through); quiet, paused or same fingerprint → `{ drop }` and the band/status line reads "Last check HH:MM — all quiet / nothing new / paused". New fingerprint → through with the digest JSON as context. Any error, missing tool or odd answer → through unchanged.
- `types/index.d.ts`: `lastCheck`, `lastTick` state.
- `commands/tick.md` (front desk section only), `briefings/front-desk.md` (one sentence on step 3).

## Spike (API types, `.claude-plugin/types/claude-code/index.d.ts`)
- Origin exists: `kind: 'scheduled-trigger'` — "A scheduled task or /loop firing its stored prompt." (lines 9665-9667).
- Drop is allowed on a command: `command` doc, lines 9919-9921: "A `{ drop }` stops a skill or prompt command before it is rendered". `/multi-manager:tick` is a prompt command (`commands/tick.md`), so it is stopped before render, no turn starts. `PromptSubmitResult` `drop: string` = "The prompt did not enter" (10011-10019).
- Doubt, unverified: line 10015 says "A hook's text is shown to the user as the reason". A drop may therefore show one short line (reason `quiet check-in`) to the user, not in the model's context. I could not confirm from the types whether that line lands in the transcript, and I did not run the real app (it would pop up on the user's screen). Needs one look in the live front desk after the next reload. Whether a scheduled tick arrives with `command` set is also not stated, so the handler accepts `command.name` or the `/multi-manager:tick` text. Per task rule I flag this rather than stop: the drop itself is allowed by the types.

## Tests run
- `npm run test:mod` → ` 61 pass` / ` 0 fail` / `Ran 61 tests across 3 files.` (new: 7 decision tests in `pane-items.test.ts`, 7 handler tests in `front-desk-pane.test.tsx`: quiet dropped with band line; news passes with digest, same fingerprint swallowed with `since`; trouble returning is shown; paused dropped; error/missing tool/odd answer passes unchanged; typed tick and other scheduled prompts untouched; non-front-desk untouched)
- `node --test test/briefings.test.ts` → `ℹ pass 10` / `ℹ fail 1`. The one failure is not mine: `every snake_case tool name in a briefing or command is a real roster tool` fails on `commands/clear.md names needs_action` (file from task 020, untouched here). My new check (tick.md front desk section names `front_desk_digest`) passes.
- `npm run lint` → clean (no output).
- `npm run typecheck:mod` → 4 errors, all `isCollapsed` missing in `AbovePrompt` mount props in the test files (3 were there before my change; the 4th is my new test copying the same `BAND` pattern). Cause: the types file in `.claude-plugin/types` (untracked, copied from the main folder) is newer than the tests. Source files (`register.tsx`, `roster-view.ts`) typecheck clean.

## Screenshots (opened and judged)
None. No click-through run: the drop path needs a live scheduled tick; covered by mod tests only.

## Decisions made
Logged in `docs/multi-manager/decisions.md` (2026-11-10, Task 022).

## Gaps
- Live behaviour of the drop (reason line shown or not, `command` set on a scheduled tick) is unverified; see Spike.
- `needs_action` in `commands/clear.md` breaks the briefings test on main; needs a fix by whoever owns 020 (e.g. a different wording or add to the test's allow list).
- `.claude-plugin/types` is not in git, so a fresh worktree cannot typecheck the mod until it is copied in.

# Round 2 (send-back round 1)
Main merged in first (582e374).
1. **Digest timeout:** `handleTick` races the digest call against `$.clock.sleep(4000)` (cancelled by an AbortController afterwards). The wait winning lets the tick through unchanged (`next(e)`). Test: a digest that never answers — still waiting at 3 s, through at 4.5 s, no context attached.
2. **`since`:** the clock is read before the digest call and that time is stored. Not separately tested (the mock roster cannot move the clock mid-call); the code path is the single `asked` variable.
3. **Drop reason:** types (`PromptSubmitResult`, lines 10011-10019) say a hook's drop text "is shown to the user as the reason" and show no silent form (no empty-reason or other field is documented). Reason is now `'·'`. Please check live whether it appears.
4. **Old-roster fallback:** `tick.md` fallback again includes the idle-stop rule (stop architects idle past the project's idle stop time with nothing assigned) and nudge/report by `recommended_action`. I also removed backticks from the digest field names (act_on etc.) there, because the briefings test reads any backticked snake_case word as a tool name.
5. **Tests added:** tick with pane notes queued attaches/empties nothing (notes still go on the next real turn); a pass where the engine beneath drops leaves `lastTick` unchanged (next tick with the same fingerprint goes through, no `since`). New mount now passes `isCollapsed: false`.

## Tests run (round 2)
- `npm run test:mod` → ` 64 pass` / ` 0 fail` / `Ran 64 tests across 3 files.`
- `node --test test/briefings.test.ts` → `ℹ pass 11` / `ℹ fail 0`
- `npm run lint` → clean
- `npm run typecheck:mod` → 3 errors, all `isCollapsed` in the older `BAND` mounts of existing tests (not mine); none in my files.
