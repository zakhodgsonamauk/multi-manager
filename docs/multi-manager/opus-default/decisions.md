# Decisions — workstream `opus-default`

## 2026-11-03 — Own state files under `opus-default/`
Context: `docs/multi-manager/status.md` and `progress.md` are the `main` workstream's handover, and other architects on this project commit to `main` in parallel. Decision: this workstream keeps status, progress and decisions in `docs/multi-manager/opus-default/`; task files stay in the shared `tasks/` folder, numbered by `allocate_number`. Alternative: share the main files (merge clashes with parallel architects).

## 2026-11-03 — Architects ignore the project default; a recorded model still wins
Context: goal #83 says architects and project managers start on Opus "whatever the project's default model is", while the user can still step any session down. Decision: with no explicit or recorded model, an architect launches on `opus`; an explicit `model` or the model recorded on the session (from its last run or a `set_session_model` step-down) still wins, so restart, restore and resume-after-pause keep a step-down. The project default now only affects developers with no task scores. `add_project` keeps storing no default; the role rule covers new projects. Alternatives: make restarts reset to Opus (would undo the user's step-downs); set `default_model = 'opus'` on new projects (would also push unscored developers to Opus, which the goal rules out).

## 2026-11-03 — No live window test
Context: the change is inside the launch rule; a real architect launch pops a Terminal tab on the user's screen, and the live roster runs every other session. Decision: prove it with the launcher's tests (they capture the exact `--model` passed to the tab command), plus a read of the roster after the next real architect launch the front desk makes. No user-facing page changes, so no browser click-through. Alternative: a throwaway-project launch (needs the front desk's OK first; offered if wanted).
