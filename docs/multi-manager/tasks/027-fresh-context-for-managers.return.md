# 027 — return report (round 2)

Branch: `worktree-mm-multi-manager-usage-efficiency-dev-027-fresh-context`. Last commit: see `git log` (ca773db plus this report).

## What changed
- An idle architect or project manager whose conversation is over the project's limit (default 200000 tokens, new setting `context_limit_tokens`, set via `add_project`) is asked to write its resume note, then restarted with a fresh conversation that resumes from `status.md` and `progress.md`. Its developers keep running.
- Idle auto-stop now acts in code, in the monitor tick, for architects and project managers. It ignores a waiting goal. Needs: idle, own quiet over `idle_stop_minutes`, no running developers (or architects, for a project manager), nothing open for it, not paused.
- A manager stopped that way comes back fresh, from its notes, as soon as an item is addressed to it (same monitor pass, every 30 s).
- Idle fix: a timer check-in turn no longer counts as the session's own activity. Claude Code marks it `turnOrigin: "scheduled"` in the transcript; that turn and its replies are skipped. The roster check-in time, session-file time and transcript file time are not used for these decisions.
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` is set for architects and project managers (safety net).
- New: `src/monitor/transcript.ts`, `src/monitor/lifecycle.ts`; tool `resume_note_written`; `front_desk_digest` field `refresh_due`.

## Tests run
Final run (focused set, never the full suite):
`node --test test/transcript.test.ts test/lifecycle.test.ts test/lifecycle-tick.test.ts test/recovery.test.ts test/monitor-enforce.test.ts test/health.test.ts test/projects.test.ts test/command.test.ts test/server.test.ts test/front-desk-digest.test.ts test/monitor.test.ts test/launcher.test.ts`
```
ℹ tests 121
ℹ pass 120
ℹ fail 1
✖ launching an architect opens a tab, stores the pid and moves the goal to planning   (test/launcher.test.ts:86)
```
That failure was fixed afterwards (see Gaps): launcher.test.ts now 23 of 23 pass. Without launcher.test.ts: all pass (earlier run, 109 tests, 108 pass, the 1 failure was the server tool list, since fixed).
- `npm run typecheck`: exits clean (tsc, no output).
- `npx eslint src test`: exit 0. `npm run lint` on the whole repo still reports 22 errors, all in `docs/multi-manager/usage-efficiency/measure/*.js` (`require`, `console`), which was already failing at session start and is not mine.

End-to-end (`test/lifecycle-tick.test.ts`, runs the real monitor tick, real Claude Code file readers over a throwaway Claude home, fake process layer, project limit 40000 and idle stop 30 min):
```
context before restart 61000 tokens, after 12000 tokens
idle stop and bring-back on an item: ok
✔ end to end through the monitor tick: refresh at a low limit, then idle stop and bring-back on an item
```
It checks: the timer turn is not counted as activity; note asked for; `resume_note_written`; restart with no `--resume` and the resume-from-notes prompt; an open item keeps a manager alive; idle stop; bring-back on an item.

New unit tests: `test/transcript.test.ts` (5), `test/lifecycle.test.ts` (11: refresh decision cases, idle-stop decision, project manager with goal awaiting sign-off stopped, one with a running architect or developer not stopped, restore on item, paused skip, unread answered item blocks refresh). Added cases in `test/command.test.ts`, `test/projects.test.ts`; `test/server.test.ts` tool list gets `resume_note_written`.

## Screenshots (opened and judged)
None. No UI.

## Decisions made
All logged in `docs/multi-manager/decisions.md` (2026-11-24 entry). Key ones:
- Code cannot wake an idle session, so the "write your note" turn goes through the front desk: digest `refresh_due` carries the message, the manager calls `resume_note_written`, the monitor restarts it on a later pass. No note, no restart.
- `launcher.ts` untouched: the fresh restart clears the saved conversation id then calls `restartArchitect`; two reason strings in `command.ts` switch `restartPrompt` to the resume-from-notes prompt.

## Gaps
- Done in round 1 after your message: `test/launcher.test.ts` expected env now has `CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400000'` (launcher.test.ts: 23 tests, all pass). I did not pull main into this branch (developer rule: never merge or rebase); you merge, and that file should merge cleanly.
- **Front desk briefing needs a line** (not mine to edit): on `refresh_due` in the digest, `SendMessage` the manager the given `message` once. Same for task 028 if it adds a briefing line about fresh starts. Without it the front desk may not act on `refresh_due`, and no big session gets refreshed.
- **Not tested in a real launched tab.** The end-to-end run uses real transcript/session files and the real monitor tick, but a fake process launcher. A real tab run was not done (it would pop windows; waiting for a go). Unverified: that `restartArchitect` kills a live (not dead) session's tab cleanly and opens the new one in practice.
- **Rule breach to disclose:** before your message arrived I ran one headless `claude -p` (with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=30000`, sonnet, a few file reads, budget cap $0.8) to check the env var. It showed a `compact_boundary` event. I did not know of the "interactive tabs only" rule. No more headless runs. If you want the env var re-checked in a launched tab, say so.
- `front_desk_digest.idle_past_limit` is left as before (architects with no live goal, report only); the monitor now acts first, so it will rarely show.
- The context size is read from the last 6 MB of the transcript; if the last assistant call is older than that, size shows unknown and nothing is refreshed.

## Round 2 (send-back round 1 fixed)
1. **Second copy of a live manager:** `lifecycle.ts` now proves the process is the session's own (wrapper, else claude.exe) and kills it itself, checking the exit code, before relaunching. Unproven or failed kill: skipped and reported, no tab opened. Idle stop records the mark only if the kill worked (else the row goes back to running). `launcher.ts` was NOT edited. The test fakes now treat a pid as owned only while alive, and a taskkill removes it (or fails on demand).
2. **Real work counted as timer activity:** `transcript.ts`: a user line with no turnOrigin, not meta, not a tool result starts the own turn. Test built from that real pattern.
3. **Stop-then-restore loop:** one definition of "waiting" (any open item, info included, or unread answer) for refresh, idle stop and bring-back; no restore in the pass that stopped it.
4. **Old marks:** the idle-stop mark carries the stopped pid; dropped when the session runs again, has another pid, or is gone. Only idle-stopped managers come back; never while paused. A resume-note request expires after 30 min or when the context is under the limit (the digest goes quiet).
5. **Conversation id** cleared only after all guards, put back if the relaunch throws.
6. **Summary window:** Claude Code's docs say the value is capped at the model's own context window (second-hand summary, not word for word; I ran no more headless checks). So 400000 never raises the limit above a smaller model. Kept at 400000.

New tests (all pass): untagged peer message after a timer turn; meta and tool-result lines inside a timer turn; transcript over 6 MB; unproven process and failed kill for refresh and for idle stop; relaunch failure keeps the saved conversation; info item causes no loop; a user-stopped manager stays stopped; mark dropped after a manual restart; no restore while paused (restores after); request expiry and shrink.

Final run: `node --test test/transcript.test.ts test/lifecycle.test.ts test/lifecycle-tick.test.ts test/recovery.test.ts test/monitor-enforce.test.ts test/health.test.ts test/projects.test.ts test/command.test.ts test/server.test.ts test/front-desk-digest.test.ts test/monitor.test.ts test/launcher.test.ts test/pm-role.test.ts`
```
ℹ tests 148
ℹ pass 148
ℹ fail 0
```
`npm run typecheck`: clean. `npx eslint src test`: exit 0. I did not pull main (you handle conflicts at merge). Still open from round 1: front desk briefing line for `refresh_due`, and no real launched-tab run.
