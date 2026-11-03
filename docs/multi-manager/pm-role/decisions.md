# Decisions — workstream `pm-role`

## 2026-11-03 — Own state files under `pm-role/`
- Context: other architects commit to `main` in parallel; `docs/multi-manager/status.md` is the `main` workstream's.
- Decision: status, progress and decisions in `docs/multi-manager/pm-role/`; task files in the shared `tasks/` folder, numbered by `allocate_number`.
- Alternatives: share the main files (merge clashes).
- Who: the architect.

## 2026-11-03 — A real `project-manager` role, living on the project's `pm` workstream
- Context: today a project manager is an architect row on a `pm` workstream; the roster cannot tell it apart, so resume, death and stuck reports skip it and the sidebar shows it as an ordinary architect.
- Decision: new session role `project-manager`; one running per project (unique index); it sits on the `pm` workstream so its own goals stay addressable; parent is the front desk; starts on Opus (same rule as architects: explicit, then recorded, then opus); own briefing file. `restart_architect` covers it (no new restart tool). No automatic conversion of existing rows: #286 keeps running as is until relaunched after merge.
- Alternatives: keep it an architect plus a flag column (every role check would still need a second condition, and the tree logic gets harder); a session with no workstream (breaks goal ownership and many project+workstream keyed tools).
- Who: the architect.

## 2026-11-03 — Sign-offs go straight to the front desk; the project manager watches
- Context: goal #89 asks to "decide whether the roster routes them directly or keeps the relay". The relay today (re-raise, wait, copy the answer back, close) adds a hop where the user's words can be paraphrased or lost, and slows every sign-off.
- Decision: an architect's `signoff` and `question` under a running project manager go straight to the front desk; the project manager is recorded as watcher, sees them and the answers in `list_items`, and gets a nudge. `done`, `blocked`, `info` still go to the project manager. The project manager may add an `info` item for the user about overlap or risk, never an approval.
- Alternatives: keep the relay, automated (the roster copies items up and answers down: two items per question, more to keep in sync); keep the manual relay (the error-prone status quo).
- Who: the architect; open for the user to overrule at plan sign-off.

## 2026-11-03 — Standing user rules stored once per project, shown at start-up
- Context: the same rules are re-pasted into every goal text (goals #69, #81, #89).
- Decision: `projects.standing_rules`, set verbatim with `set_project_rules` (front desk or that project's project manager), shown word for word by the SessionStart hook to every session of that project.
- Alternatives: put them in the briefing (not per project); in `approval_rules` (different purpose, and approval rules are read by architects only).
- Who: the architect.

## 2026-11-03 — Testing approach
- Context: the change is roster code, the sidebar pane and briefing text. There is no browser page; the user-facing surface is the front-desk sidebar. Real launches pop terminal tabs on the user's screen, and reloading the roster interrupts every running session.
- Decision: focused unit tests per task (launcher tests capture the exact tab command, so no real tabs); the database change rehearsed on a copy of the live roster database; the sidebar checked from a rendered screenshot of test data, judged by the architect; after all four merge, an end-to-end run on a throwaway roster database (separate file, no tabs). The live switch-over (reload, relaunching #286 as a project manager, writing each project's standing rules) only on the user's go via the front desk.
- Alternatives: a live launch on a throwaway project (pops windows; offered if wanted).
- Who: the architect; part of the plan sign-off.

## 2026-11-03 — Merging is a live change on this project; ask before the first one
- Context: the plugin runs from the project folder, so every hook and new tab opens the live roster with whatever is on `main`. Task 010 rebuilds the live sessions table on first open.
- Decision: hold the 010 merge until the user answers item #895 (merge as each task passes, recommended; or one switch-over at the end).
- Alternatives: merge without asking (the plan sign-off implied merges were not live, so the user did not knowingly approve a live database change).
- Who: the architect; the user decides via item #895.
