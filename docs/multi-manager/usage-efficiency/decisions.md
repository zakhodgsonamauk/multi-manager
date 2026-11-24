# Decisions

One dated entry per decision, newest last. Never rewrite an old entry. Add a new one that supersedes it.

## 2026-11-24 — Measure from transcripts, not the roster

- Context: The roster's spend and model-use records are empty, because this roster is new today.
- Decision: Measure from the transcript files (`~/.claude/projects`) with a script. Keep the script in `measure/` and the baseline data on this PC only in `conductor/usage-baseline/` (the repo is public and the data names private projects), so that before-and-after can be compared once the changes are in.
- Alternatives: Use the older Dropbox roster's self-reported spend. Rejected because it is self-reported, has gaps, and cannot be split by trigger.
- Who: the architect.

## 2026-11-24 — Order the work by measured savings

- Context: Re-reading long manager conversations is 79% of the estimated cost. Idle timer ticks are 17%.
- Decision: Run the tasks in this order:
  - 026: quiet check-ins with no model turn. Biggest certain saving, and simplest.
  - 027: fresh restarts for big, idle managers, plus an idle auto-stop that works.
  - 028: cheaper helper agents, Fable and nudges.
  - 029: smaller start-up text, only if the user agrees.

  026 and 027 run one after the other because they edit the same health code.
- Alternatives:
  - Raise the timer to 30 or 60 minutes. Rejected: it only cuts the tick cost by 3-6 times, while code-side checks cut it to near zero.
  - Lower the automatic-summary threshold only. Kept as a safety net inside 027, but only if Claude Code supports it.
- Who: the architect.

## 2026-11-24 — Leave the "Other active sessions" line alone

- Context: The line comes from the user's own claude-context-sync hook, not from this plugin.
- Decision: Out of scope for this workstream. Raised as a question in the sign-off.
- Alternatives: None. Editing another project's hook is not this workstream's job.
- Who: the architect.

## 2026-11-24 — Run 027 before 026

- Context: The user approved the plan (item #2). 026, 028 and 029 touch files that have someone else's unsaved edits, and committing those is waiting on item #4.
- Decision: Start 027 now. Its one briefing line moves to 028, and it takes over the idle-measure fix from 026. 026 follows after 027 merges, because they share health code.
- Alternatives: Wait for item #4 and change nothing. Rejected, because it would block the whole plan on an unrelated question.
- Who: the architect.

## 2026-11-24 — Q3: leave the "Other active sessions" line

- Context: The user agreed to the default: "yes, if that tool can be switched off per tab; otherwise leave it".
- Decision: Leave it. claude-context-sync has no per-tab switch today.
- Who: the user's agreed default (item #2), checked by the architect.

## 2026-11-24 — Q2: build the middle-man in two steps

- Context: The user's answer to Q2: "ideally we'd wrap plugins in some sort of middle-man so they're still available, but only stuck into context when relevant." Claude Code has no lazy loading for skills. It can turn plugins and claude.ai connectors off for one session through the `--settings` file.
- Decision:
  - 029: turn the other plugins and the connectors off in Multi-Manager tabs. Add roster tools `find_skill` and `load_skill` that serve those plugins' skills on demand.
  - 031: an MCP broker (`find_tool`, `describe_tool`, `call_tool`) for the user's other tool connections. Build it only if 029's measured saving shows it is worth it. MCP tools are already loaded lazily, so the remaining cost is only their names and instructions, about 7.6k tokens.
- Alternatives: Edit each skill's frontmatter to hide it. Rejected because it changes other plugins' files. Use a global `skillOverrides` setting. Rejected because it does not apply to plugin skills.
- Who: the architect, carrying out the user's Q2 answer.

## 2026-11-24 — Plugins that stay on in Multi-Manager tabs (task 029)

- Context: The 029 review found that `session-voice` was switched off in tabs, which breaks `set_voice`.
- Decision: The keep-list is Multi-Manager, claude-in-chrome, second-opinion, code-review-graph, session-voice, cc-sounds and claudish-to-english. The last three are hook plugins the user relies on, and they add little start-up text.
- Alternatives: Keep only Multi-Manager's own plugins. Rejected because it silently breaks voice, sounds and the plain-English rewrite in tabs.
- Who: the architect.

## 2026-11-24 — Quiet check-ins for architects and project managers (task 026)

- Context: Every architect and project manager ran a 10-minute model turn just to find nothing to do.
- Decision: The mod (`hooks/register.tsx`) runs the check-in in code for architect and project-manager sessions too, asking a new roster tool `manager_digest` (own scope: developers or architects, plus unseen items, plus its own resume-note request). A model turn starts only when that digest is not quiet and its fingerprint is new, reusing the front desk's `decideTick`. The briefings no longer arm a timer; a `CronCreate` of the tick is refused while the panel loop is alive. The first check is one loop turn after the 10 minutes (a manager has no start-up step that sets the schedule).
- Decision: Items addressed to the manager count while unseen (the Stop hook marks them seen). Items it only watches cannot be marked seen by the watcher, so they are listed once by time (`since`, the time of the last turn started).
- Decision: A check-in turn the system started is recognised in the transcript by its tick-command text (any turn origin except `human`), not only by turn origin `scheduled`, because the origin the host gives a plugin-started turn is not known.
- Decision: Idle stop kills first and checks the exit code; only after a good kill does `stopSession` clean up. A resume-note request that expired is remembered (`refresh_expired_at`) and not re-asked for 2 hours.
- Alternatives: The roster monitor nudging a manager only when its scope has news. Rejected: the mod route needs no new message path and reuses the front desk's tested decision code.
- Who: developer, task 026.

## 2026-11-24 — Wrap-up testing under "only if headless"

- Context: The user's answer to item #25 was "can run tests but only if headless!". A manager's quiet check-in loop and a fresh restart need a real interactive terminal, and a restart opens a Terminal tab by design.
- Decision: Measure start-up size with headless `claude -p` runs. Rely on the focused and end-to-end tests for 026 and 027. Confirm 026 and 027 from real use after go-live, by re-measuring with the saved scripts.
- Alternatives: Hidden consoles. Rejected: Windows can hand them to Windows Terminal and pop a window. A fake `wt.exe`. Rejected: too hacky for a test.
- Who: the architect, under the user's rule.
