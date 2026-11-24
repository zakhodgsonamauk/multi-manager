# 032 — Backup backends: definitions and health checks

Goal #4. Branch: `worktree-mm-multi-manager-backup-models-dev-032-backends`. Return report: `docs/multi-manager/tasks/032-backup-backend-definitions.return.md` on that branch.

## Goal
When Claude usage runs out, the user falls back on hand-made launchers in Dropbox (`claude-on-box.bat`, `claude-on-strata.bat`, and `multi-model-ai\launch-cc-with-glm.bat`). Multi-Manager knows nothing about them. This task teaches Multi-Manager what each backup is, in one place, as plain data plus small checks. Nothing launches on them yet (that is task 033).

Each backup ("backend") is: a name; the address Claude Code should talk to (`ANTHROPIC_BASE_URL`); where its access key comes from, **by environment variable name only**; how the haiku/sonnet/opus tiers map to its model(s); context and reply-length limits; and a readiness check.

Backends to define (read the Dropbox files for exact values; never copy a key value):
- `claude`: the normal subscription. Empty definition, always the default.
- `box`: the LeaderGPU box. Address from the launcher. Key from env var `LEADERGPU_LLM_KEY`, falling back to the same-named value under `HKCU\Environment`. Model name and context length discovered at check time from `/v1/models` and `/status`; report "slowed" if `/status` says so. Port the context-margin logic from the current Dropbox `claude-on-box.bat` (the `BOX_COMPACT_*` part).
- `strata`: local Strata model server (OpenAI format) behind a litellm proxy. Discover the loaded model and context length from `/v1/models`. Needs a proxy: see below.
- `glm`: Ollama at `localhost:11434`, model `glm-5.3:cloud`; dummy token `ollama`. Check: Ollama answers and lists the model.

The user chose exactly these three backups, in this order: `glm`, then `box`, then `strata` (sign-off #13, Q2: "glm, then box, then strata ONLY"). Export that order as the default preference list. Do **not** define `gpt` or `minimax`.

Shared proxy (strata's litellm): Multi-Manager starts **one** when the first session needs it, on a fixed or probed free port, records its process id in the roster folder, and stops it when the last session using it has stopped. Write the start / stop / is-running functions here, with a "users" count the launcher will drive in 033. Never leave a proxy running with no users (the user keeps the PC lean).

The readiness check returns `{ ready, model, contextTokens, note }` and never throws. A box that is unreachable or a proxy program that is missing gives `ready: false` with a plain-words note ("the LeaderGPU box is not reachable", "litellm is not installed: run python -m pip install \"litellm[proxy]\"").

Also export `backendEnv(name, tier)` returning the environment variables a session needs (names copied from the Dropbox launchers: `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, and so on), **with the key left out**. The key source is returned separately as `{ fromEnvVar: "LEADERGPU_LLM_KEY" }` so 033 can have the tab read it at start-up and never write it to a file.

## Tests first
In `test/backends.test.ts`:
- every backend's `backendEnv` contains no value that looks like a secret, and `box` names `LEADERGPU_LLM_KEY` as its key source;
- tier mapping: on `box`, haiku/sonnet/opus all map to the discovered model; on `glm`, all three tiers map to `glm-5.3:cloud`; the preference list is exactly `glm, box, strata`;
- context margin: a 262144-token box gives the same `CLAUDE_CODE_MAX_CONTEXT_TOKENS` the Dropbox launcher computes (work the expected number out from the .bat by hand, in the test comment);
- readiness check against a fake local HTTP server: ready; unreachable; "slowed"; strata with no loaded model;
- proxy lifecycle with a fake proxy program: first user starts it, second reuses it, last stop kills it, a stale pid file from a dead process is cleaned up.

## Files expected to change
- new `src/backends/` (definitions, checks, proxy lifecycle)
- new `test/backends.test.ts`
- `README.md`: a short "Backup backends" section listing each backend and its prerequisites.

## Out of scope
- Anything in `src/launch/`, `src/roster/db.ts`, `src/roster/tools.ts`, `hooks/` (tasks 033-036; `src/launch/` is being changed by goal #2).
- Editing or moving the Dropbox launcher files. Read only.
- Installing litellm or Ollama models.

## Test scope
`node --test test/backends.test.ts`, `npm run typecheck`, `npx eslint src/backends test/backends.test.ts`. Never the full suite. Fake servers and fake proxies only; no real network calls in tests.

## Evidence required
Test summary lines. A one-off run of each readiness check against the real machine (box, strata, Ollama), pasted as the plain-words result, with no key shown.
