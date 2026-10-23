# 005 — return report (round 1)

Branch: `worktree-mm-multi-manager-main-dev-005-late-pid`. Last commit: `6535c71` (the fix); this report is committed on top of it.

## What changed
Cause: when a new tab sat behind Claude Code's "trust this folder?" prompt for more than the launcher's 30 s wait, the session was saved with no process id and no conversation id, and nothing ever filled them in later. The monitor skipped it, and a model change relaunched it without its conversation.

- `src/monitor/monitor.ts`: new `adoptLatePids`, run first in every monitor tick. For each running architect/developer with no recorded process id, it looks up the newest Claude Code session file naming that session whose process is a live `claude.exe` in the tick's own process snapshot (`findSessionPid`, the same rule as `findLivePid`), and records the pid. A pid already held by another running session is never handed out. The existing conversation-id refresh then fills in the conversation in the same tick. The lookup is injected as `MonitorDeps.findSessionPid`; `realMonitorDeps` wires the real one, so the live monitor (`server.ts`) and the `monitor_tick` tool both get it.
- `src/launch/launcher.ts` (`changeSessionModel` only, plus a small helper `readLiveConversation`): if the row has no conversation id, it finds the session's `claude.exe` (recorded pid, else by name), checks it really is this session's (`ownsProcess`), reads the conversation id from it **before** closing it, saves it on the row, and resumes with it.

## Tests run
New tests, written first and seen failing (2 of 20 failed before the fix: the monitor pickup and the model-change resume):
- `test/monitor-late-pid.test.ts`: pid-less running developer with a live claude for its name gets pid and conversation after one tick; a pid-less row with only a stale file / a file whose pid now belongs to notepad stays empty, the architect row only gains its conversation id, and no items are raised; a live claude for a different name is ignored; a pid already held by another running session is not adopted.
- `test/change-model.test.ts`: new test, row with pid and conversation both empty, `findPid` finds the process, `readClaudeSessionId` returns a conversation only while that process has not been killed → relaunch carries `--resume <that id>`, `resumed: true`, no "fresh conversation" warning, and the process found by name is the one closed.

```
node --test test/monitor-late-pid.test.ts test/change-model.test.ts test/monitor.test.ts test/tools-monitor.test.ts test/recovery.test.ts
ℹ tests 41
ℹ suites 0
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1032.1383
```

```
npm run typecheck
> multi-manager@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
exit 0
```

```
npm run lint
> multi-manager@0.1.0 lint
> eslint .
exit 0
```

## Screenshots (opened and judged)
None: no screen changed. Behaviour is in the background monitor and the model-change tool.

## Decisions made
Logged in `docs/multi-manager/decisions.md` under "2026-10-23 — Picking up a tab's process after the launch gave up (task 005, developer #53)":
- The monitor checks liveness against its own process snapshot instead of calling `findLivePid`, which would add a tasklist call per pid-less session per tick.
- Pickup runs before death detection, so a session found this tick is death-checked and gets its conversation id in the same tick.
- A pid already held by another running session is never adopted.
- The model change reads the conversation only after `ownsProcess` confirms the process, and saves it before the close, so it survives a failed close or relaunch.

## Gaps
- Not tried against a real tab stuck behind the trust prompt (task says fakes and temp databases only). The real wiring is `findSessionPid(name, { isLive })` against `~/.claude/sessions`, the same code `findLivePid` already uses at launch.
- `restartArchitect` / `restart_developer` still resume only from a recorded conversation id. With this change the monitor fills that in within one tick of the trust prompt being answered. If the tab dies before then, a restart still starts fresh. Changing that is outside this task.
- Full suite not run (task scope).

---

# 005 — return report (round 2)

Send-back: matching by session name alone could adopt another cluster's same-named tab (two clusters can each have a project `alpha`, so both have `mm-alpha-main`).

## What changed
- `src/launch/process.ts`: new `cwdWithin(cwd, folder)`. It compares Windows paths ignoring case, `/` vs `\`, `..` and trailing separators. "Within" means equal or under, so `C:\work\alpha2` is not under `C:\work\alpha`, and a missing or blank path never counts. `findSessionPid` takes an optional `within` folder and skips session files whose `cwd` is outside it.
- `src/launch/runner.ts`: `findLivePid` and `LaunchDeps.findPid` pass `within` through (optional, so existing callers are unchanged).
- `src/monitor/monitor.ts` (`adoptLatePids`): looks a pid-less session up only inside its folder (the row's `folder`, else its project's folder). A session with no folder is skipped.
- `src/launch/launcher.ts`:
  - `readLiveConversation` reads the conversation of a process found by name only if it runs inside the session's folder.
  - `killTarget` (the close step shared by stop, restart and model change) now uses the same folder rule when it looks a process up by name. Without this, a model change would still have closed the other cluster's tab after refusing to read its conversation. It now refuses with its usual "could not close … model not changed" message. A row with no folder still matches by name, as before.

## Tests run
New or changed tests, written before the fix. Before the fix both files failed to load: `SyntaxError: The requested module '../src/launch/process.ts' does not provide an export named 'cwdWithin'`. That run never reached the cross-cluster assertions, so I never saw them fail on their own.
- `test/monitor-late-pid.test.ts`:
  - the adopted developer's file now has its worktree cwd (`c:/A/.claude/worktrees/<name>` under project folder `C:\a`) and is still adopted;
  - new: same-named live claude in `D:\cluster-b\alpha`, and one in `C:\a2\…` (prefix case), are not adopted;
  - new: `cwdWithin` unit cases (case, separators, trailing separator, drive root, `alpha2` prefix, parent folder, `..`, blank and missing).
- `test/change-model.test.ts`:
  - the resume test's process now runs in the developer's worktree under `C:\work\alpha`;
  - new: same-named tab in `D:\cluster-b\alpha`. Its conversation is never read, nothing is killed or launched, and the model and row stay unchanged.

```
node --test test/monitor-late-pid.test.ts test/change-model.test.ts test/monitor.test.ts test/tools-monitor.test.ts test/recovery.test.ts test/pause.test.ts test/launch-model.test.ts test/health.test.ts test/voice.test.ts test/launcher.test.ts
ℹ tests 87
ℹ suites 0
ℹ pass 87
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 964.7689
```
(The last five files fake `findPid`; they were added because its signature changed.)

```
npm run typecheck
> multi-manager@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
exit 0
```

```
npm run lint
> multi-manager@0.1.0 lint
> eslint .
exit 0
```

## Screenshots (opened and judged)
None: no screen changed.

## Decisions made
Logged in `docs/multi-manager/decisions.md` under "2026-10-23 — Late pid pickup must stay inside the session's folder (task 005 round 2, developer #53)":
- one helper (`cwdWithin`) behind an optional `within` on `findSessionPid`;
- the folder is the row's `folder`, else the project's;
- no folder means no pickup by the monitor;
- the close step uses the folder rule too.

## Gaps
- Beyond the send-back's two places: the folder rule also covers `killTarget`, so stop and restart are covered too. Without it, the model change would still close the other cluster's tab. Revert that one line if you want it out of scope.
- Still name-only: the launch's own 30 s wait (`waitForPid`) and the voice tool's process lookup (`src/roster/tools-voice.ts`). Two clusters launching same-named tabs in the same second could still cross at launch. Not touched.
- Not tried on real tabs; fakes and temp folders only, as the task says.
