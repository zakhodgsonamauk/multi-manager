# 033 — Start a session on a backup backend

Goal #4. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/033-start-session-on-backup.return.md` on that branch.
Waits for: nothing (032 merged c5908cf; goal #2 task 026 merged add9843; 031 not waited on, agreed with architect #3).

## Goal
Any Multi-Manager session (developer, architect, project manager) can be started on a backup backend from task 032 instead of the normal Claude subscription, and the roster remembers which.

- Roster: new nullable `sessions.backend` (null means `claude`) and `projects.default_backend`.
- `launch_developer` and `launch_architect` take an optional `backend`. Order: explicit argument, else project default, else `claude`.
- Before launching on a backup, run its readiness check (032). Not ready: do not open a tab; return the plain-words note.
- Start the shared proxy if the backend needs one (032's lifecycle), and stop it when the session stops (`stop_developer`, `stop_architect`, tab closed, monitor finds it dead).
- The environment from `backendEnv` goes into the session's settings file env block, next to `MM_*`. The key does **not**: the tab's start-up script reads it from the named environment variable (or `HKCU\Environment`) into `ANTHROPIC_AUTH_TOKEN` for that process only. No key in any file, log, roster row or command line.
- Multi-Manager's own plugin and the roster tool connection stay on for backup sessions (the Dropbox launchers turn most plugins off; do not copy that blanket switch-off).
- The roster tier (haiku/sonnet/opus) still goes on `--model`; the backend's alias variables map it to its real model.
- Every relaunch keeps the backend: `restartArchitect` (also used by goal #2's task 027 fresh restart and auto-restore), `changeSessionModel`, `restart_developer` and `restore_all` read `backend` from the roster row. A session on a backup must never silently go back to Claude.

## What 032 gives you (merged as c5908cf, read `src/backends/`)
- `checkBackend(name)` returns `{ ready, model, contextTokens, note }`; `backendEnv(name, tier, info)` returns the env without the key; the box's key source is `BACKENDS.box.keySource` (`fromEnvVar`, `registryFallback`, `setAs`).
- Strata: call `findLitellm` and `strataProgram`, then `acquireProxy(sessionId, …)` before opening the tab; pass the proxy's address as `info.baseUrl` to `backendEnv('strata', …)`. Call `releaseProxy(sessionId, dir)` on every stop path, and have the monitor tick call `reconcileProxy(liveSessionIds, dir)` so a crashed tab never keeps the proxy alive. The proxy calls are already serialised in-process.
- Goal #2's task 029 already switches off unrelated plugins for manager tabs; backup tabs follow the same keep-list rules as Claude tabs (no extra switch-off).

## Tests first
Extend `test/command.test.ts` and `test/launcher.test.ts`, and add `test/launch-backend.test.ts`:
- a `box` launch writes the base address and model aliases into the settings env and **no** token; the start-up script reads `LEADERGPU_LLM_KEY`;
- a scan of every file the launch writes finds no key value (use a fake key value in the test env);
- not-ready backend: no tab opened, note returned;
- project default backend used when no argument; explicit argument wins;
- proxy started on the first `strata` session and stopped on the last one's stop;
- `claude` (or null) launches are exactly the same as before this task;
- one test per relaunch path (`restartArchitect`, the 027 fresh restart, `changeSessionModel`, `restart_developer`, `restore_all`): a session on `box` comes back on `box`.

## Files expected to change
`src/launch/command.ts`, `src/launch/launcher.ts`, `src/launch/wrapper.ts`, `src/roster/db.ts` (migration), `src/roster/tools.ts` (the `backend` argument; a `set_project_default_backend` tool), tests. Claim `src/roster/db.ts` before editing.

## Out of scope
Switching a running session (034), noticing usage ran out (035), the pane (036).

## Test scope
The new and extended test files above, `npm run typecheck`, eslint on changed files. Never the full suite.

## Evidence required
Test summary lines. One real developer tab started on a backup that is ready on the day (Ollama `glm` is the cheapest), doing a one-line job (read a file, reply), with a screenshot of the tab, opened and judged, and `list_sessions` showing its backend. Close the tab after. Ask the architect before opening it (it appears on the user's screen).
