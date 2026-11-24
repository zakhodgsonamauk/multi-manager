# 037 — Backend proxy tests must never open windows or leave processes behind

Goal #4. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/037-hidden-proxy-tests.return.md` on that branch.
Urgent: roster item #29. Takes priority over task 033's review.

## What happened
Between 19:38 and 19:46 on 2026-11-24, runs of `test/backends.test.ts` (task 032, on main) opened about six visible Windows Terminal windows (`OpenConsole -Embedding`) while the user was gaming. They also left 12 processes running: fake proxies (`%TEMP%\mm-test-*\fake-proxy.js`, ports 47832-47838), each with a `node -e "setTimeout(() => {}, 120000)"` child. The front desk killed them. The user said: "you've opened loads of terminal windows wtf is going on".

Stopgap on main (`454763c`): the eight proxy tests are skipped with `SKIP_SPAWNING`, and `findLitellm`'s python call now passes `windowsHide: true`.

## Cause (architect's reading; confirm it)
- `src/backends/proxy.ts:216` starts the proxy with `detached: true`. On Windows that is `DETACHED_PROCESS`, so the proxy has **no console**. Any console program it starts without `windowsHide` gets a brand-new console. With Windows Terminal as the default terminal, that console is a visible window.
- The fake proxy (`test/backends.test.ts` around line 188) starts its child without `windowsHide`, which is exactly that case. The real litellm (Python) can start helpers the same way.
- Leftovers: the test spawns at about lines 247, 273 and 293 have no `windowsHide`. Children are not always killed when a test fails. Parallel runs (two people ran the suite at the same time) share the fixed port range 47832-47841, so one run's fake proxy answers another run's port probe.

## Goal
1. **No new consoles, ever.** On Windows, start the proxy with `windowsHide: true` and **without** `detached`. It then gets a hidden console (`CREATE_NO_WINDOW`), and anything it starts shares that hidden console. Elsewhere keep today's behaviour. Write down in the return report what this means for the proxy outliving the session that started it. The roster server runs inside the starting tab's kill-on-close job, so `detached` never let it escape that job anyway. A dead proxy is already restarted by the next `acquireProxy` / `reconcileProxy`.
2. **Every spawn in the tests is hidden.** That covers `windowsHide: true` on every `spawn` / `execFile`, including the fake proxy's own child.
3. **Nothing outlives its test.** Each test kills every process tree it started in `t.after`, even when the test fails. Every test process carries a unique marker for this run in its command line (for example the temp folder name).
4. **A guard test that fails when something leaks.** A final `after()` hook (or last test) lists processes whose command line contains this run's marker (`Get-CimInstance Win32_Process` on Windows, `ps` elsewhere). If any remain, it fails, listing them, and kills them.
5. **No port clashes between runs.** Let `acquireProxy` take the port range in its options (default 47832-47841). The tests pick a random free range well away from it.
6. Remove the `SKIP_SPAWNING` skips.

## Tests first
Before un-skipping, add the leak guard (4) and an explicit test: "the fake proxy's child runs with no visible window". On Windows, assert the child's process has no console window of its own, or at minimum was started with `windowsHide`. Then fix the code until every test in the file passes with the guard green.

## Files expected to change
`src/backends/proxy.ts`, `test/backends.test.ts`. Nothing else.

## Out of scope
Task 033's files (`src/launch/`, `src/roster/`). Any real backend (Strata is unloaded; the user said "pause before model tests"). No real litellm, Ollama or box calls.

## Test scope
Only `node --test test/backends.test.ts`, plus `npm run typecheck` and eslint on the two files. Run the test file **once** after you have read your code for hidden spawns, not in a loop. Never run the full suite.

## Evidence required
- The test summary lines.
- Proof, captured by script, before and after the test run:
  - the count of `node.exe` processes whose command line contains `mm-test-` or `fake-proxy` (must be 0 after);
  - the count of `OpenConsole.exe` and `WindowsTerminal.exe` processes, and of processes with a visible main window (`Get-Process | Where-Object MainWindowHandle -ne 0`). After must equal before.
- Paste the numbers in the return report.
