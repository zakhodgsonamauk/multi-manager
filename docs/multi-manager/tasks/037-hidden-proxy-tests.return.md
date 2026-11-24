# 037 return: hidden proxy tests

## What changed
- `src/backends/proxy.ts`: the proxy is started with `detached: process.platform !== 'win32'` (plus the existing `windowsHide: true`). On Windows it now has a hidden console (CREATE_NO_WINDOW) shared by anything it starts.
- `test/backends.test.ts`: SKIP_SPAWNING removed (eight tests live again). Every spawn is `windowsHide: true` (idle nodes, the dead-pid node, the fake proxy's child, taskkill, the powershell process lister). All test folders live under one per-run folder `mm-test-run-*`, which is the marker in every test process command line (script path, or an extra argument). Random 10-port range 20000-40000 passed as `firstPort`/`lastPort` (acquireProxy already took them; no API change). New tests: leak guard (finds a marked process, gone after kill), "fake proxy and its child run with no visible window", a per-proxy-test leak check, and a final `after()` that fails the run and kills anything still marked. The "dies mid-use" test now kills the first proxy's child (child.pid was overwritten by the second proxy).

## Spawn audit before any run
Read every spawn/execFile/spawnSync in proxy.ts (lines 105, 152, 216, 283), checks.ts (47) and the test file: all had windowsHide except the test's own spawns (dead node, hung node, other node, fake proxy's child), now fixed. The proxy spawn was hidden but `detached`, which on Windows is DETACHED_PROCESS (no console).

## Test commands (run twice in total, the limit)
`npm run typecheck` and `npx eslint src/backends/proxy.ts test/backends.test.ts`: clean.

Run 1: `node --test test/backends.test.ts`
- `ℹ tests 18 / ℹ pass 17 / ℹ fail 1`. The failure was the final `after()` leak guard: "test processes were left running (now killed): fake-proxy.js ... | node -e setTimeout(...)". Before: node mm-test/fake-proxy=0 OpenConsole=7 WindowsTerminal=1 MainWindow=19. After: 0 / 6 / 1 / 19.

Run 2 (after adding per-test leak check):
- `ℹ tests 17 / ℹ pass 16 / ℹ fail 1`; failing: "a live pid with a silent port is killed and replaced ... left processes running (now killed): fake-proxy.js ... | node -e ...". Before: 0 / OpenConsole=6 / WindowsTerminal=1 / MainWindow=19. After: 0 / 6 / 1 / 19.

Both runs: no new OpenConsole, WindowsTerminal or main windows; 0 test processes after (the guard killed the leftovers).

## Cause of the remaining failure (confirmed from the guard output, then fixed)
That test never releases its proxy; it relies on the `t.after` reconcile. My first per-test leak check was a separate `t.after`, and node:test runs after-hooks last-registered first, so the check ran before the cleanup. A test-ordering artifact, not a product leak: every test that releases its own proxy passed the check. Fix: one `t.after` (reconcile, kill child, then check). The final fix was NOT run (two-run limit); only typecheck and eslint were re-run, clean.

## Cause of the windows (confirmed by reading, not by reproducing)
`detached: true` on Windows is DETACHED_PROCESS: the proxy has no console, and its children started without windowsHide (the fake proxy's `node -e` child, and litellm's helpers) each get a new console, which Windows Terminal shows. Not reproduced (no windows were to be opened).

## Proxy outliving the session that started it
On Windows the proxy is no longer detached, so it is a normal child of the roster server. The roster server already runs inside the starting tab's kill-on-close job, so a detached proxy never escaped that job; behaviour there is unchanged. A dead proxy is restarted by the next acquireProxy / reconcileProxy. If the roster server exits cleanly, the proxy is not killed by its parent (no handle tie) but is still reaped by the state file on next start.

## Decisions
Logged in docs/multi-manager/backup-models/decisions.md (2026-11-24, task 037).

## Gaps
- Final run of the fixed hook not executed.
- "No visible window" is asserted as: spawn text has windowsHide: true, and proxy + child have MainWindowHandle 0. A hidden-vs-new console cannot be observed from outside the process.
- Non-Windows branch (ps lister, process groups) not run here.
