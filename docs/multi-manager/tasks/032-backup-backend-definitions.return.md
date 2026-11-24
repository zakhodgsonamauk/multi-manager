# 032 return: backup backend definitions and health checks

Branch: `worktree-mm-multi-manager-backup-models-dev-032-backends`

## What changed
- `src/backends/definitions.ts`: the four backends as data, the preference list (`glm, box, strata`), `computeLimits` (context margin ported from `claude-on-box.bat`), `backendEnv(name, tier, info?)` (no key; key named in `keySource: { fromEnvVar: "LEADERGPU_LLM_KEY", registryFallback: true, setAs: "ANTHROPIC_AUTH_TOKEN" }`).
- `src/backends/checks.ts`: `checkBackend(name, opts)`, never throws. Box reads `/v1/models` + `/status` (reports slowed), strata needs litellm and a `loaded` model, glm needs Ollama listing `glm-5.3:cloud`. Plain-words notes.
- `src/backends/proxy.ts`: shared litellm lifecycle: `acquireProxy` (first starts, later reuse, counts users), `releaseProxy` (last one kills the process tree), `proxyStatus` (cleans a stale file whose process is dead or port is silent), `findLitellm`, `strataProgram`. State in `<roster folder>/strata-proxy.json`.
- `test/backends.test.ts` (15 tests), README "Backup backends" section.

## Tests
```
node --test test/backends.test.ts
ℹ tests 15
ℹ pass 15
ℹ fail 0
npm run typecheck   -> no errors
npx eslint src/backends test/backends.test.ts -> no output (clean)
```
Margin check, by hand from the .bat: 262144/8 = 32768 ceiling, reply stays 32000; compact at 262144 - 32000 - 16384 = 213760. Test asserts `CLAUDE_CODE_MAX_CONTEXT_TOKENS = 213760`.

## Real machine, one run (no key shown)
- glm: not ready: "Ollama is not running on this PC (localhost:11434)".
- box: ready, model `qwen3.8-27b-heretic-int4-int8`, 262144-token conversations, not slowed.
- strata: ready, model `inkling-2-mini-sq-15`, 524288-token conversations (litellm installed).

## Decisions
- Auth tokens `ollama` (glm) and `strata-local` (strata) are the launchers' own dummy values, not secrets; they are in `backendEnv`. Box has none: key comes from `keySource`.
- A backend with a conversation under 32768 tokens reports `ready: false` (the .bat only warned).
- Proxy readiness = TCP port answers (no HTTP health URL), so any fake or real program works.

## Gaps
- Real litellm start/stop not exercised here (fake proxy only, as instructed).
- `backendEnv('strata', ...)` needs `info.baseUrl` = the proxy address from `acquireProxy`; 033 must pass it.
- Only `dev-032` files touched; Dropbox launchers read only.

## Send-back round 1 (fixed)
1. Hung proxy: `proxyStatus` now kills the process tree (`killTree`) before forgetting it, but only if the pid's image name (tasklist / ps) matches the program recorded at start, so a reused pid is never killed. Tests: "live pid with a silent port is killed and replaced", "reused pid ... is not killed".
2. Users are now a set of session ids: `acquireProxy(sessionId, opts)`, `releaseProxy(sessionId, dir)` (both idempotent), `reconcileProxy(liveSessionIds, dir)` (drops absent ids, stops the proxy when none left). Tests: crashed session via reconcile; proxy dies mid-use then old/new release; tree kill (fake proxy with a child process: both gone after last release).
3. Lock: in-process promise chain `locked()` runs acquire/release/reconcile/status one at a time; file header says one Multi-Manager process owns the state file. Test: three overlapping acquires start exactly one proxy.
4. Strata check now also calls `findLitellm` ("litellm.exe not found where Python keeps its programs ... run python -m pip install ..."); `strata-litellm.yaml` is deleted whenever the proxy stops or fails to start. Tests: missing-program note; yaml gone after last release.

Run: `node --test test/backends.test.ts` -> tests 15, pass 15, fail 0. `npm run typecheck` and `npx eslint src/backends test/backends.test.ts` clean. Test cleanup runs `reconcileProxy([])` and asserts nothing is left running.
Remaining gap: real litellm start/stop not exercised (fake proxy only).
