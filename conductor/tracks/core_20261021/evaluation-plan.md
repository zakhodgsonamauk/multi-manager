# Plan Evaluation Report: core_20261021

**Track**: core_20261021 (Core, Stage 1)
**Evaluator**: loop-plan-evaluator (Evaluate-Loop Step 2)
**Date**: 2026-10-21
**Plan evaluated**: `conductor/tracks/core_20261021/plan.md` (plan_version 1, 7 phases, 24 tasks)
**Execution mode**: PARALLEL after the Phase 1 gate
**Board**: not convened (orchestrator instruction). A collapsed multi-lens review (architecture, security, operations) is in section 8.

## Verdict: FAIL. Return to the planner with 10 required fixes.

The plan is strong. Spec coverage is complete, the store and launcher code is detailed and testable, and the DAG has no cycles. It fails on three counts:

1. Phase 1 as written is unsafe and partly unexecutable on this machine. It tells the operator to close every Windows Terminal window, which would close the user's live Claude sessions, including the main session driving this run. It also assigns to "an agent" steps that only the main session or the human can do.
2. The DAG has a hidden dependency. Tasks 4.2 and 4.3 import files created by 3.1, yet run in parallel with it.
3. Two environment facts about this machine would derail the spike and AC6: the workspace-trust dialog, and the user's global Stop hook.

Every fix is local. None changes the architecture.

---

## 1. Results

| Pass | Status | Notes |
|---|---|---|
| Scope Alignment | PASS | Every R0–R7 and AC1–AC6 maps to tasks. The additions are justified and recorded as assumptions. |
| Overlap Detection | PASS | `tracks.md` lists only this track. The repo has no code: only `README.md`, the placeholder `.claude/check.cmd` and `conductor/`. |
| Dependencies | FAIL | 4.2 and 4.3 depend on 3.1 files but are not ordered after it (RF8). External dependencies are fine; see section 4. |
| Task Quality | FAIL | Task 1.2 has a destructive step (RF1), ambiguous actors (RF4, RF5), an unguarded kill (RF6), a stale note (RF3) and an unhandled trust dialog (RF7). Task 7.2 does not account for the user's global Stop hook (RF9). |
| DAG Validation | FAIL | No cycles and all references are valid. The pg-1 grouping and the "only read afterwards" claim are wrong (RF8). |
| Board Review | SKIPPED | Per orchestrator. Inline multi-lens review in section 8. |

### Parallel execution summary (as planned, before RF8)

- Total tasks: 24. Parallel groups: 7. Max concurrency: 6 (pg-1).
- Groups marked `conflict_free`: 7. Actually conflict-free: 6. pg-1 has a read-after-create dependency on `test/helpers.ts` and `src/roster/db.ts`.

---

## 2. Verification of the orchestrator's concerns against this machine

Every check below was read-only. No Claude session or wt tab was launched. No process was closed or killed. Nothing was installed.

### Concern 1: "Close every Windows Terminal window first" (Task 1.2 Step 1, Task 4.3, README in 7.1)

Confirmed unacceptable. `WindowsTerminal.exe` pid 13084 has been running since 13:24. The main session is `claude.exe` pid 3260 (session file `~/.claude/sessions/3260.json`, name `multi-manager-ac`, nameSource `derived`), and its parent is `pwsh.exe` pid 16760 inside that Terminal.

Facts found:

- **Version and fragment location.** Windows Terminal 1.24.12741.0 is the packaged Store build (`Microsoft.WindowsTerminal_8wekyb3d8bbwe`). The user-scope fragment path in the plan is correct per Microsoft's "JSON fragment extensions" page: `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\{app-name}\{file-name}.json`. The `Fragments` folder does not exist yet.
- **No documented reload.** The Microsoft page says nothing about when fragments are read, and a web search found no documentation that Terminal re-reads fragments on a settings hot-reload. Treat hot-reload pickup as **an unverified hypothesis** for the spike to test, not a fact.
- **Profile GUID.** It is deterministic. The namespace is `{f65ddb7e-706b-4499-8a50-40313caf510a}`, then UUIDv5 over the app name, then UUIDv5 over the profile name, both UTF-16LE. I checked my implementation against Microsoft's two published samples (Git/Git Bash gives `{2ece5bfe-…}`; Ubuntu gives `{2c4de342-…}`). For app `multi-manager` and profile `Multi-Manager` it gives **`{d5a290e8-6140-55ff-995f-f0c7c76ec05f}`**.
- **Signals Terminal leaves on disk** (`%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\`):
  - `state.json` has `generatedProfiles` (8 GUIDs today, including the WSL Ubuntu `{2c4de342-…}`) and `settingsHash`.
  - `settings.json` holds stub entries for generated profiles with `"source"` values (`Windows.Terminal.Wsl`, `Windows.Terminal.Azure`, …).
  - Once Terminal loads the Multi-Manager fragment, the GUID above should appear in one or both. That gives a check that needs no visual inspection.
- **Tab check via UI Automation.** `CASCADIA_HOSTING_WINDOW_CLASS` windows and their `TabItem` names can be listed read-only from PowerShell; I tested this and it lists the current Terminal windows and tab titles.
  - The spike can check without looking at the screen that a tab titled exactly `mm-spike-main` appeared and that it later disappeared.
  - An exact, stable title is also evidence the profile was applied. Its `suppressApplicationTitle: true` stops Claude Code from overwriting the title with its own (Claude's titles look like `◐ <name>`).
- **Unknown profile names.** If `--profile "Multi-Manager"` names a profile Terminal has not loaded, Terminal is expected to fall back to the default profile. The default has no `closeOnExit` (the user's settings set none). The tab would then **stay open** after `taskkill`, and R0 step 7 would fail misleadingly. Step 1 detection must therefore gate Step 3.
- **Restore on restart.** `firstWindowPreference` is not set (default), so Terminal does not restore persisted layouts. A Terminal restart will not re-run architect command lines.

What the plan must say instead: see RF1 (spike) and RF2 (production installer, launcher and README).

### Concern 2: hook `args` array

**No change required.** Exec form is supported:

- The Claude Code hooks reference (code.claude.com/docs/en/hooks, fetched today) lists `args` as a command-hook field. "When present, `command` is resolved as an executable and spawned directly with `args` as the argument vector, with no shell involved." `${CLAUDE_PLUGIN_ROOT}` is substituted inside each `args` element, and the page recommends exec form for any hook that references a path placeholder.
- On Windows, exec form needs `command` to resolve to a real `.exe`. `node` resolves to `C:\Program Files\nodejs\node.exe`, so that holds.
- The installed `cc-sounds` plugin already uses `"command": "powershell", "args": [...]` in its `hooks/hooks.json` on this machine.

So the spike's `--settings` hook (Task 1.1), `hooks/hooks.json` (Task 5.3) and `.mcp.json` (Task 6.2, standard MCP `command` plus `args`) are all correct. Keep exec form. It avoids quoting `Dropbox (Personal)`.

### Concern 3: stale AC1 note

Confirmed stale. Spec line 145 already says "a pass on all eight R0 steps". The note appears in two places: Task 1.2's **Spec** line and Assumption 10. See RF3.

### Concern 4: which spike steps need the main session or the human

Confirmed from the SendMessage tool contract in this Claude Code build:

- "if you are a subagent, your send goes out under your parent session's address, and any reply is delivered to the parent session's conversation, not to you."
- `ListAgents` is the discovery tool for cross-session targets. It is not available to subagents.

The `ListAgents` call, the SendMessage round trip, the PONG reply and the reverse nudge therefore have to happen **in the main session itself**. Typing in the tab and the final look at the closed tab are **human** steps. See RF4.

### Concern 5: the main session as the spike front desk

Feasible. The main session is an interactive `claude.exe` in Windows Terminal. Per the orchestrator it runs with bypass permissions, and the spike tab runs `--dangerously-skip-permissions` (that is, `bypassPermissions`), so the modes match and messages should not be held. The reverse-nudge `to` is then the main session's ListAgents name. Its session file says `multi-manager-ac` today, but that name is derived and can change, so read it at run time. See RF5.

### Concern 6: other Windows failure points for Phase 1 and Task 2.1

- **Git Bash path conversion.** In the agent's Bash tool, MSYS turns `/PID` into `C:/Program Files/Git/PID`, so `taskkill /PID … /T /F` breaks. The plan already says "use PowerShell" and gives `MSYS_NO_PATHCONV=1`; RF6 makes it explicit for agents. The production runner is not affected: Node `execFile('taskkill', ['/PID', …])` does not go through MSYS. Task 2.1's `cmd //c .claude\\check.cmd` for Git Bash is correct.
- **`execFile` of the WindowsApps `wt.exe` alias.** On this machine Node reports `lstat` as a symlink of 93 bytes, `stat` fails with `EACCES`, and `access(X_OK)` succeeds.
  - So `fs.existsSync(wtPath)` returns **false** for the alias. No code may use `existsSync` or `statSync` as a "wt installed?" check. The plan has none today; keep it that way.
  - Spawning the alias through CreateProcess normally works, but I did not run it (that would launch a tab). Spike Step 3 is the first real test. Fallback if it fails: spawn the bare name `wt.exe` and let PATH resolve it.
- **Quoting through wt.exe.**
  - Node quotes arguments that contain spaces. wt.exe splits its command line and rebuilds the `commandline` part, re-quoting arguments that contain spaces. Parentheses are harmless. `;` must be escaped as `\;`, which the plan does.
  - Embedded `"` characters are **not** escaped by wt's rebuild, so an argument containing `"` corrupts the command line. `architectPrompt` has none. `developerPrompt` embeds free task text (for example `Add a "Save" button`) and only strips `;`. Newlines in task text are also unsafe. See RF10.
  - The spike's own prompt has no quotes, so Phase 1 is safe.
- **`-w multi-manager`.** On first use this creates a new named window inside the existing `WindowsTerminal.exe` (pid 13084) and does not touch the user's other windows. Later calls add tabs to it. Nothing to fix; record it in spike.md.
- **Resolving `claude`.** `claude` is the native `C:\Users\zak_h\.local\bin\claude.exe`, and that folder is in the user's registry PATH, so a WT tab will find it. Image name `claude.exe` matches `ownsProcess`. Optional hardening: resolve the absolute path once (`where.exe claude`) and pass it to `wt`.
- **Workspace trust (new finding).**
  - The docs (permissions page, "Project allow rules and workspace trust") say "Claude Code shows the trust dialog in interactive sessions only."
  - No `%TEMP%` path is trusted in `~/.claude.json`, so the spike tab in `%TEMP%\mm spike project` will probably open on a trust dialog. The docs do not say whether `--dangerously-skip-permissions` skips it.
  - That would hold up the initial prompt, the SendMessage tests and possibly the session-file timing. See RF7.
- **The user's global hooks run in every tab.** `~/.claude/settings.json` adds SessionStart hooks (`project-setup.mjs`, `project-health.mjs`, `graph-daemon.mjs`, `conflict-check.mjs`) and a Stop hook (`stop-gate.mjs`, timeout 150 s).
  - When files were edited, `stop-gate.mjs` blocks the turn (exit 2) if the project has no check command ("Files were edited but this project has no check command — set one up…").
  - The spike session does not edit files, so Phase 1 is unaffected. The AC6 architect in `hello-site` will be. See RF9.

---

## 3. Spec traceability (Pass 1)

| Spec | Plan tasks | Covered |
|---|---|---|
| R0 steps 1–8, AC1 | 1.1, 1.2 | Yes. Step 1 needs RF1, Steps 3–5 need RF4, RF5 and RF7, Step 7 needs RF6. |
| R1 plugin skeleton (plugin.json, .mcp.json, briefings, 5 commands, hooks, `--plugin-dir`) | 6.1, 6.2, 5.3, 7.1 | Yes |
| R2 roster store (path, `MM_ROSTER_DB`, WAL, busy timeout, 7 record types, defaults, claims refusal naming holder, spend over budget) | 3.1–3.8 | Yes. The default approval text matches the spec word for word (3.2 test). |
| R3 roster MCP server (identity from env, all tool groups, status, launch and stop) | 6.3 | Yes. 25 tools, a superset of R3. |
| R4 launch and stop (wt command, env via `--settings`, pid store, `taskkill /T /F`, return existing, permission warning, developers) | 4.1–4.5, 6.3 | Yes. Two documented deviations: `--settings` gets a file path (the help says `<file-or-json>`) and `--plugin-dir` is added. Both are acceptable. |
| R5 hooks (SessionStart and Stop, no-op without `MM_SESSION_ID`, block once) | 5.1–5.3 | Yes |
| R6 briefings (front desk, architect, developer duties) | 6.1 | Yes. Duties are pinned by regex tests. |
| R7 check command, after user approval of installs | 2.1 (with a confirmation point), 7.1 | Yes |
| AC2 `npm run check` via `.claude/check.cmd` | 2.1, 7.1 | Yes |
| AC3 store tests (all 8 listed areas, temp DB via `MM_ROSTER_DB`) | 3.1–3.8 | Yes |
| AC4 launch command builder tests (exact args, with and without skip, env) | 4.1 | Yes |
| AC5 Stop hook tests (block once, not twice, no-op when unset) | 5.2 | Yes |
| AC6 manual end-to-end, `e2e.md` | 7.2 | Yes, but needs RF9 and a trust note (RF7). |

Scope creep: `launch_developer` and `stop_developer` (justified by R4's last bullet), `scripts/dump-roster.ts` (supports AC6 evidence) and `get_briefing` (supports R6 helper agents). All are small and traceable. No unjustified tasks.

---

## 4. Dependencies and DAG (Passes 3 and 5)

- Nodes: 24, all IDs unique. Every `depends_on` reference resolves.
- I checked for cycles by hand over every edge: none. Every edge points to an earlier task.
- **Defect (RF8): a read-after-create dependency inside pg-1.**
  - `test/process.test.ts` (4.2) and `test/terminal-profile.test.ts` (4.3) import `tempDir` from `test/helpers.ts`, which 3.1 creates. `helpers.ts` itself imports `../src/roster/db.ts`, also from 3.1.
  - `src/launch/terminal-profile.ts` (4.3) imports `type Env` from `../roster/db.ts`.
  - The test for 4.4 also imports `helpers.ts`, but 4.4 is fixed transitively once 4.2 and 4.3 depend on 3.1.
  - With 4.2 and 4.3 in pg-1 alongside 3.1, a parallel worker on 4.2 or 4.3 fails at "run the failing test, then make it pass" with `ERR_MODULE_NOT_FOUND`. The plan's sentence "`test/helpers.ts` is created in 3.1 and only read afterwards" is false for pg-1.
- Other edges are correct, for example 4.5 → 3.4 and 3.6; 6.3 → 3.8, 4.5, 5.1 and 6.1; 5.1 → 3.5.
- External dependencies: Node 25.5.0 (has `node:sqlite` and type stripping), the native Claude Code 2.1.306 binary, Windows Terminal 1.24 and git are present. Every CLI flag the plan uses exists: `-n`, `--settings` (file or JSON), `--plugin-dir`, `--mcp-config`, `-w/--worktree` and `--dangerously-skip-permissions` are in `claude --help`. `--append-system-prompt-file` is not in `--help`, but the CLI reference documents it and says all system-prompt flags "work in both interactive and non-interactive modes". npm packages are installed only after user confirmation (Task 2.1). Fine.
- Parallel note (recommendation, not required): each task's "typecheck and lint the whole tree" step can fail on a sibling's half-written files if parallel workers share one working tree. Use worktrees per worker, or scope the check to the task's files until the group merges.

---

## 5. Task quality (Pass 4)

- Phases 2–7 are specific, file-targeted and session-sized, with verifiable acceptance (exact test counts and commands). Quality is high.
- Task 1.2 is the weak task. The fixes are below.
- Task 7.2 needs RF9.

---

## 6. Required fixes (planner must apply all)

### RF1. Task 1.1 Step 1 and Task 1.2 Step 1: install the fragment without closing Windows Terminal, and detect pickup without looking

- **Task 1.1 Step 1.** Add `"guid": "{d5a290e8-6140-55ff-995f-f0c7c76ec05f}"` to the profile in `spike/multi-manager.json`. This is the value Terminal would generate for app `multi-manager` and profile `Multi-Manager`; writing it explicitly makes detection deterministic. Keep it byte-identical with Task 4.3's `FRAGMENT` and its test (see RF2).
- **Task 1.2 Step 1.** Delete "Close every Windows Terminal window first, because fragments are read when Terminal starts" and "Then open Windows Terminal." Replace them with:
  1. Copy the fragment (the existing `New-Item` and `Copy-Item` lines, unchanged). Add a hard rule: **never close, restart, stop or kill `WindowsTerminal.exe` or any Terminal window.** The user's sessions, including the main session, live there.
  2. Detect pickup without looking at the screen. Poll for up to 15 s for the GUID in either of these files under `$lp = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState"`:
     - `$lp\state.json` → `generatedProfiles`
     - `$lp\settings.json` → a profile entry with that `guid` or with `"source": "multi-manager"`

     Record which signal appeared. Read-only PowerShell snippet:
     `(Get-Content "$lp\state.json" -Raw | ConvertFrom-Json).generatedProfiles -contains '{d5a290e8-6140-55ff-995f-f0c7c76ec05f}'`
     and
     `Select-String -Path "$lp\settings.json" -SimpleMatch 'd5a290e8-6140-55ff-995f-f0c7c76ec05f'`.
  3. If it is not detected, try a non-destructive hot reload. Updating only the settings file's timestamp leaves its content unchanged: `(Get-Item "$lp\settings.json").LastWriteTime = Get-Date`. Then poll again for 15 s. Mark this as an **unverified hypothesis**: it assumes Terminal's settings watcher reloads everything, fragments included. Record the outcome either way. Optionally copy `settings.json` to `%TEMP%` first, and do not commit that copy.
  4. If it is still not detected, this is a **human step** and the spike pauses. Ask the user to do one of two things, at a moment they choose: open Terminal Settings (Ctrl+,) and press Save, or restart Windows Terminal themselves after closing their own sessions. Then poll again. Record what worked.
  5. **Gate:** do not start Step 3 until the profile is detected. If it never is, record R0.1 as FAIL and NO-GO.
  6. Make "the new-tab dropdown lists Multi-Manager" optional human corroboration, not the acceptance check.
- **spike.md template, row 1.** Evidence becomes: "detected via: state.json generatedProfiles / settings.json stub / neither; mechanism: already loaded / timestamp touch / Settings→Save / user restart".

### RF2. Tasks 4.3, 4.4, 4.5, 6.3 and 7.1: production profile handling without "restart Windows Terminal"

- **Task 4.3.**
  - Add `guid` to `FRAGMENT` and to the expected object in `test/terminal-profile.test.ts`.
  - Add a pure, tested `terminalProfileStatus(env)` returning `'loaded' | 'not-loaded' | 'unknown'`. It looks for the GUID using the signal the spike recorded (state.json `generatedProfiles` and/or settings.json). It checks the packaged stable path `Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState`, the Preview package `Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe` and the unpackaged `%LOCALAPPDATA%\Microsoft\Windows Terminal\`. It returns `unknown` when none exist.
  - Add tests with temp `LOCALAPPDATA` fixtures for each case.
  - In `scripts/install-terminal-profile.ts`, replace "Restart Windows Terminal so it picks up the Multi-Manager profile." with a status line. When the status is `not-loaded`, print the non-destructive guidance from RF1 (Settings→Save, or restart Terminal when convenient). It must never close Terminal.
- **Task 4.4 / 4.5.**
  - Extend `LaunchDeps` with `terminalProfileStatus(): 'loaded' | 'not-loaded' | 'unknown'`. Alternatively, have `ensureTerminalProfile` return `{ written, status }`.
  - When the status is not `loaded`, `launchTab` must push a warning and still launch: "Windows Terminal has not loaded the Multi-Manager profile yet, so this tab will not close when stopped. Open Terminal Settings and press Save, or restart Terminal when convenient."
  - Add one launcher test for this warning, and update the `fakeDeps` default to `'loaded'`.
- **Task 6.3.** `start_front_desk` includes the same profile status and warning in its output.
- **Task 7.1 Step 5 (README).** Replace `node scripts/install-terminal-profile.ts   # then restart Windows Terminal once` with the script line plus one sentence: "If it reports the profile is not loaded yet, open Terminal Settings and press Save (or restart Terminal when convenient). Do not close Terminal windows that hold running sessions."

### RF3. Task 1.2 Spec line and Assumption 10: remove the stale AC1 note

- Task 1.2 **Spec** line: delete `The spec's AC1 still says "four R0 steps". Read that as all eight revised steps.` Keep `R0 steps 1–8, AC1`.
- Delete Assumption 10 ("Spec AC1 wording…") and renumber Assumption 11.

### RF4. Task 1.2: say who does each step, and stop for the human GO/NO-GO

Restructure Steps 1–11 into labelled parts, with an "Actor" for each step:

- **Part A: automatable.** Any agent, including a subagent, using the **PowerShell** tool.
  - Step 1: install and detect (RF1).
  - Step 3: run `spike-launch.mjs`, then the CommandLine and parent-process check.
  - A UI Automation check that a tab titled exactly `mm-spike-main` exists. The tab-listing snippet in section 2 can be adapted; this is the RF1 profile-applied evidence.
  - Step 7: read `spike-hook-env.json` and `spike-mcp-env.json`.
  - Step 9: the pid-lookup fields from `spike-launch-result.json`.
  - Then write `spike.md` with Part A rows filled in and the rest marked PENDING, and **stop**. Report to the orchestrator that Parts B–D need the main session and the human.
- **Part B: main session only.** Subagents cannot do this: `ListAgents` is not available to them, and replies to a subagent's cross-session send are delivered to the parent's conversation.
  - Step 4: ListAgents (record the raw row and the `[ref]` if shown).
  - Step 5: SendMessage `What is your codename?` and receive `HERON` as `<cross-session-message from=…>`. Record the `from` value and whether it arrived pushed or only later.
  - Reverse nudge: SendMessage the spike session asking it to `SendMessage` `<main session name>` with "check roster item #1". The main session must receive it. This replaces "type in the spike tab".
  - Step 7's shell check: ask the spike session by SendMessage to run `echo $env:MM_ROLE` and reply with the output.
- **Part C: human.**
  - Accept the trust dialog if one appears (RF7).
  - Step 6: type `Say hello in one word.` in the tab. Then the main session sends `ping 2` and expects `PONG ping 2`.
- **Part D: kill, then final checks.** Run the guarded `taskkill` (RF6) from the main session's PowerShell tool, or have the human run it. Then:
  - UI Automation: the tab titled `mm-spike-main` is gone.
  - `Test-Path` on the stale session file.
  - Human visual confirmation that no "process exited with code" tab remains.
- **Then** finish `spike.md`. The **human** makes the GO/NO-GO call; an agent does not.
- Change the NO-GO instruction "set `metadata.json` `status` to `"blocked"`" to "report NO-GO to the orchestrator and the user". The orchestrator owns `metadata.json`.
- Change the task's **Type** line to say this explicitly, replacing "(manual: a human, or an agent with the user watching)".

### RF5. Task 1.2 Step 2: allow the main session as the spike front desk

- Rewrite Step 2: "Preferred: the main session (the one driving this run) acts as the spike front desk. It already runs with bypass permissions, matching the spike tab's `--dangerously-skip-permissions`. Confirm its permission mode and record it in spike.md. Alternative: start a separate `claude -n mm-spike-desk --dangerously-skip-permissions` in a new tab the human opens."
- In Step 5 and the reverse nudge, replace the hard-coded `mm-spike-desk` with "the front desk's ListAgents name". When the main session is the desk, that is its own name: currently `multi-manager-ac` per `~/.claude/sessions/3260.json`, but read it at run time because it is a derived name.
- In the spike.md template, row 4's evidence gains "front desk used: main session `<name>` / separate `mm-spike-desk`".

### RF6. Task 1.2 Step 8: guard the kill, and say which shell to use

Before `taskkill`, add this guard. It aborts, killing nothing, unless all of these hold:

- `$p` is a positive integer read from `spike-launch-result.json`.
- `$p` is not the main session's pid (`$PID`'s parent chain, or the `pid` in the main session's own `~/.claude/sessions/*.json`).
- `Get-CimInstance Win32_Process -Filter "ProcessId=$p"` shows `Name = claude.exe` and a `CommandLine` that contains `-n mm-spike-main`.

Example:

```powershell
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
if (-not $proc -or $proc.Name -ne 'claude.exe' -or $proc.CommandLine -notmatch '-n mm-spike-main') { throw "Refusing to kill $p" }
```

Then add these statements:

- `taskkill /T` kills only descendants, so the parent (expected: `WindowsTerminal.exe`) survives.
- Never pass a Terminal pid.
- Agents run Step 8 with the **PowerShell** tool. In the Bash tool, use `MSYS_NO_PATHCONV=1 taskkill /PID $p /T /F` or `taskkill //PID $p //T //F`.

### RF7. Task 1.2 Step 3 (and a 7.2 note): handle the workspace-trust dialog

Add to Step 3:

- "`%TEMP%\mm spike project` is not a trusted folder. Interactive Claude sessions show a trust dialog in untrusted folders, and it is not documented whether `--dangerously-skip-permissions` skips it. If the tab opens on a trust dialog, the human accepts it (Part C). Record in spike.md whether it appeared, and whether the session file appeared before or after acceptance (`waitedMs`)."
- Raise `spike-launch.mjs`'s poll from 60 × 500 ms to 240 × 500 ms (120 s), so the pid lookup survives a dialog.
- Do not edit `~/.claude.json` to pre-trust the folder during the spike. Live sessions read and write that file.
- Add a "Notes for implementation" line in the spike.md template: "Trust dialog: appeared yes/no; implication for add_project / first architect launch per project."
- In Task 7.2 Step 2, row 3, expect and allow a one-time trust acceptance in the `mm-hello-site-main` tab (`%TEMP%\mm-e2e\hello-site` is untrusted). Record it.

### RF8. DAG: 4.2 and 4.3 depend on 3.1

- `4.2.depends_on: ["2.1"]` becomes `["3.1"]`.
- `4.3.depends_on: ["2.1"]` becomes `["3.1"]`.
- Update the task headers' `<!-- deps: … -->` comments to match.
- New groups:
  - `pg-1: [3.1, 4.1, 6.1, 6.2]`
  - `pg-2: [3.2, 4.2, 4.3]`
  - `pg-3: [3.3, 3.4, 4.4]`
  - `pg-4: [3.5, 3.6]`
  - `pg-5: [3.7, 4.5, 5.1]`
  - `pg-6: [3.8, 5.2]`
  - `pg-7: [5.3, 6.3]`
- Recheck the 4.5 level: it depends on 3.4 (L3), 3.6 (L4) and 4.4 (L3), so it stays at L5.
- Update the one-line graph.
- Replace the sentence "`test/helpers.ts` is created in 3.1 and only read afterwards" with "`test/helpers.ts` and `src/roster/db.ts` are created in 3.1; every task that imports them (3.2+, 4.2, 4.3, 4.4, 4.5, 5.x, 6.3) depends on 3.1 directly or transitively".

### RF9. Task 7.2 Step 1: give the throwaway project a check command

The user's global Stop hook `~/.claude/hooks/stop-gate.mjs` blocks any turn that edited files in a project without a check command (`check.mjs`, …, or `.claude/check.cmd`). The AC6 architect edits `hello-site`, so without one every stop is blocked with "set one up (with user approval)". That derails steps 5–9.

In Task 7.2 Step 1, before `git add`, create `"$e2e\hello-site\.claude\check.cmd"` with a trivial passing check. For example:

```bat
@echo off
rem e2e throwaway check
exit /b 0
```

Better: run the test the architect writes. Then add one sentence to the e2e notes: "Architects inherit the user's global hooks; projects without a check command trip stop-gate."

### RF10. Task 4.1: keep `"` and newlines out of wt.exe arguments

wt.exe's command-line rebuild does not escape embedded double quotes, and `developerPrompt` embeds free task text.

- In `developerPrompt`, also replace `"` with `'` and `\r?\n` with a space; `architectPrompt` already has none.
- Extend the "initial prompts … contain no semicolons" test to also assert no `"` and no newline, using a task like `Add a "Save" button;\nthen test`.
- Optionally add an assertion in `buildLaunchCommand` that no argument contains `"` or a newline, with a clear error and a test.

---

## 7. Recommendations (non-blocking; planner may adopt)

1. **Stronger pid-reuse guard (4.2/4.4).** Session files in 2.1.306 carry `procStart` (for example `"procStart":"134370597355540856"`). Store it with the pid at launch. In `ownsProcess`, also compare it with the live process's creation time from `Get-CimInstance Win32_Process` `CreationDate`, or skip this if the name-plus-image check is judged enough.
2. **Front desk name auto-detection (6.3).** `start_front_desk` can read `~/.claude/sessions/<process.ppid>.json` (the MCP server's parent is the front desk's `claude.exe`) and use its `name`. Architects' nudges then target the real ListAgents name even when the user starts the desk without `-n mm-front-desk`. Today the derived name would make every architect→desk nudge miss, and only Stop-hook and status recovery would remain.
3. **Consent integrity (6.3, security).** Restrict `answer_item` to the front-desk identity (`ctx.identity.role === 'front-desk'`), so an architect cannot answer its own sign-off. Restrict `stop_architect` to the front desk too. Both are one-line guards; each needs a server test.
4. **Spike evidence hygiene (1.2 Step 11).** `spike-launch-result.json` records every candidate session file (the user's other session names, `messagingSocketPath` pipe names). Trim `candidates` and `sessionFile` to the matching entry before committing, as the spike.md template already does for the pasted copy.
5. **Absolute `claude.exe` path (4.1/4.4).** Resolve it once with `where.exe claude` and pass it to `wt`, so tabs do not depend on Terminal's PATH snapshot. This is a no-op today, since `~/.local/bin` is in the user's registry PATH.
6. **Wt `--profile` by GUID.** Once RF1 adds the GUID, `--profile "{d5a290e8-…}"` is rename-proof. Optional.
7. **Developer `--worktree` through wt.** The spike only checks architect arguments. In 7.2, or a later stage, confirm that `-w/--worktree <name>` after `claude` passes through wt's parser intact (Task 1.2's CommandLine check method).
8. **Parallel typecheck.** See section 4.
9. **Global hooks in architect tabs.** The spike should note in "Notes for implementation" whether the user's SessionStart hooks (`project-setup`, `graph-daemon`, …) visibly run in the spike tab. Architects will pay that start-up cost in every project.

---

## 8. Collapsed multi-lens review

**Technical architecture.**

- Sound. The store is a plain module shared by the MCP server, hooks and tests. The command builder is pure and the runner is thin. Identity comes from `--settings` env, and hooks do nothing outside Multi-Manager sessions.
- Schema constraints carry real invariants: the partial unique index enforces one running architect per workstream, and the claims uniqueness is case-insensitive.
- Risk points are concentrated in the spike, which is the right place.
- The `--settings` file path is a sound deviation from inline JSON, given wt's `;` and `"` handling.
- The SDK 1.32 `registerTool` and zod 4 combination was not compiled during planning (Assumption 9). Task 6.3 states a fallback. Acceptable.

**Security.**

- `--dangerously-skip-permissions` everywhere is an explicit user decision in the spec and design, accepted.
- The stop path refuses to kill anything whose session file name and image (`claude.exe`) do not match. Good. RF6 adds the same discipline to the manual spike kill, and Recommendation 1 hardens it further.
- Roster consent depends on briefing discipline. Recommendation 3 enforces it in code.
- The roster DB is local and per-user with no secrets. Settings files hold env values only.
- No credentials appear in the plan.

**Operational feasibility.**

- The main operational hazards were the destructive Terminal restart (RF1/RF2), actor ambiguity in a mixed agent and human spike (RF4/RF5), an unexpected trust dialog (RF7) and the user's global Stop hook (RF9). All are addressed by the required fixes.
- Cleanup steps are scoped to `%TEMP%` scratch folders.
- The npm install is gated on user confirmation (Task 2.1), consistent with R7 and the orchestrator's hard stop.

---

## 9. Board conditions to carry forward

None (board not convened). These items must be verified at EVALUATE_EXECUTION:

- `spike.md` records the profile-detection signal and the mechanism used.
- Task 4.3 implements exactly that signal.
- The final `spike.md` decision was made by the human.
