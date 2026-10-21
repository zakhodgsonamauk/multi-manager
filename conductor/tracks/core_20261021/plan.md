# Core (Stage 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use orchestrator-supaconductor:executing-plans to implement this plan task-by-task.

**Goal:** One Claude Code window acts as the Multi-Manager **front desk**. It registers projects, takes a goal, opens an **architect** in its own Windows Terminal tab in the project folder, receives the architect's plan sign-off through a shared roster, records the user's answer word for word, reports status from the roster, and stops architects. A stopped architect's tab closes completely.

**Architecture:** A Claude Code plugin (`multi-manager`) at the repo root. A plain TypeScript **roster store** (`src/roster/*`, `node:sqlite`, no MCP dependency) is shared by three consumers: the stdio **roster MCP server** (`src/roster/server.ts`, tools for every session), the **hooks** (`scripts/*-hook.ts`, which do nothing unless `MM_SESSION_ID` is set), and the tests. Launching goes through a pure **command builder** (`src/launch/command.ts`: `wt.exe … claude …` plus a `--settings` file that carries the `MM_*` env) and a small **runner** (`src/launch/runner.ts`: execFile, session-file pid lookup, `taskkill /T /F`). The briefings in `briefings/*.md` are passed with `--append-system-prompt-file`. Users drive it through `commands/*.md` (`/multi-manager:<command>`).

**Tech Stack:** Node 25 (runs `.ts` directly with type stripping, so only erasable syntax), `node:sqlite` `DatabaseSync` (WAL, busy_timeout), TypeScript 6.0 `tsc --noEmit`, ESLint 10 flat config with typescript-eslint 8, `node --test`, `@modelcontextprotocol/sdk` 1.x with `zod` 4, Windows Terminal (`wt.exe`) with a JSON fragment profile, Claude Code 2.1.306.

---

## Context

- **Track**: `core_20261021`
- **Spec**: `conductor/tracks/core_20261021/spec.md`. The spec is authoritative. This plan follows the revised R0/R4: tabs, not `claude --bg`.
- **Design**: `conductor/designs/2026-10-21-multi-manager-design.md`, build order stage 1.
- **Dependencies**: none. This is the first track.
- **Overlap check**: `conductor/tracks.md` lists only this track, and the repo has no code. No overlap.
- **Execution mode**: PARALLEL after the Phase 1 gate (see DAG).
- **Out of scope (YAGNI)**: watchdog, voice changes, status page, phone, crash recovery and restart, loop detection, SupaConductor integration, more than one front desk.

### Conventions for every task

- Use only erasable TypeScript: no `enum`, no `namespace`, no constructor parameter properties. Import relative files with the `.ts` extension, and write `import type` for types (`verbatimModuleSyntax`).
- `node:sqlite` returns rows with a null prototype. Store functions return plain objects through `one()`/`many()` from `src/roster/db.ts`, so `assert.deepEqual` works on them.
- Store functions that depend on time take `now: Date = new Date()` so tests can fix the clock.
- Run commands from the repo root `I:\Dropbox (Personal)\Projects\multi-manager`. They work in both PowerShell and Git Bash unless a step says otherwise.
- Commit with two `-m` flags. This works in both shells:
  `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`
- Run a single test file with `node --test test/<name>.test.ts`. Run everything with `npm test`.

### Traceability

| Spec | Tasks |
|---|---|
| R0 spike / AC1 | 1.1, 1.2 |
| R1 plugin skeleton | 5.3, 6.1, 6.2, 7.1 |
| R2 roster store / AC3 | 3.1–3.8 |
| R3 roster MCP server | 6.3 |
| R4 launch and stop / AC4 | 4.1–4.5, 6.3 |
| R5 hooks / AC5 | 5.1–5.3 |
| R6 briefings | 6.1, 6.2 |
| R7 check command / AC2 | 2.1, 7.1 |
| AC6 manual end-to-end | 7.2 |

---

## Dependency Graph

```yaml
dag:
  nodes:
    - { id: "1.1", name: "Spike kit (scripts and fragment)", type: "config", phase: 1, depends_on: [], estimated_duration: "20m",
        files: ["conductor/tracks/core_20261021/spike/multi-manager.json", "conductor/tracks/core_20261021/spike/spike-launch.mjs", "conductor/tracks/core_20261021/spike/spike-hook.mjs", "conductor/tracks/core_20261021/spike/spike-env-mcp.mjs", "conductor/tracks/core_20261021/spike/spike-briefing.md"] }
    - { id: "1.2", name: "Run R0 spike, record spike.md, GO/NO-GO gate (manual)", type: "docs", phase: 1, depends_on: ["1.1"], estimated_duration: "45m",
        files: ["conductor/tracks/core_20261021/spike.md"] }
    - { id: "2.1", name: "Tooling: package.json, tsconfig, eslint, check.cmd", type: "config", phase: 2, depends_on: ["1.2"], estimated_duration: "20m",
        files: ["package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", ".gitignore", ".claude/check.cmd", "test/toolchain.test.ts"] }
    - { id: "3.1", name: "Roster db module + test helpers", type: "code", phase: 3, depends_on: ["2.1"], files: ["src/roster/db.ts", "test/helpers.ts", "test/db.test.ts"] }
    - { id: "3.2", name: "Projects and workstreams", type: "code", phase: 3, depends_on: ["3.1"], files: ["src/roster/projects.ts", "test/projects.test.ts"] }
    - { id: "3.3", name: "Sessions and tree", type: "code", phase: 3, depends_on: ["3.2"], files: ["src/roster/sessions.ts", "test/sessions.test.ts"] }
    - { id: "3.4", name: "Goals", type: "code", phase: 3, depends_on: ["3.2"], files: ["src/roster/goals.ts", "test/goals.test.ts"] }
    - { id: "3.5", name: "Items (escalations)", type: "code", phase: 3, depends_on: ["3.3", "3.4"], files: ["src/roster/items.ts", "test/items.test.ts"] }
    - { id: "3.6", name: "Claims", type: "code", phase: 3, depends_on: ["3.3"], files: ["src/roster/claims.ts", "test/claims.test.ts"] }
    - { id: "3.7", name: "Spend and budgets", type: "code", phase: 3, depends_on: ["3.5"], files: ["src/roster/spend.ts", "test/spend.test.ts"] }
    - { id: "3.8", name: "Status summary", type: "code", phase: 3, depends_on: ["3.6", "3.7"], files: ["src/roster/status.ts", "test/status.test.ts"] }
    - { id: "4.1", name: "Launch command builder (pure)", type: "code", phase: 4, depends_on: ["2.1"], files: ["src/launch/command.ts", "test/command.test.ts"] }
    - { id: "4.2", name: "Claude session-file pid lookup", type: "code", phase: 4, depends_on: ["2.1"], files: ["src/launch/process.ts", "test/process.test.ts"] }
    - { id: "4.3", name: "Windows Terminal profile fragment", type: "code", phase: 4, depends_on: ["2.1"], files: ["src/launch/terminal-profile.ts", "scripts/install-terminal-profile.ts", "test/terminal-profile.test.ts"] }
    - { id: "4.4", name: "Runner (execFile, wait for pid, ownsProcess)", type: "code", phase: 4, depends_on: ["4.1", "4.2", "4.3"], files: ["src/launch/runner.ts", "test/runner.test.ts"] }
    - { id: "4.5", name: "Launcher: launch/stop architect and developer", type: "code", phase: 4, depends_on: ["3.4", "3.6", "4.4"], files: ["src/launch/launcher.ts", "test/launcher.test.ts"] }
    - { id: "5.1", name: "SessionStart hook", type: "code", phase: 5, depends_on: ["3.5"], files: ["src/hooks/common.ts", "src/hooks/session-start.ts", "scripts/session-start-hook.ts", "test/session-start-hook.test.ts"] }
    - { id: "5.2", name: "Stop hook (block once)", type: "code", phase: 5, depends_on: ["5.1"], files: ["src/hooks/stop.ts", "scripts/stop-hook.ts", "test/stop-hook.test.ts"] }
    - { id: "5.3", name: "hooks/hooks.json", type: "config", phase: 5, depends_on: ["5.2"], files: ["hooks/hooks.json", "test/hooks-config.test.ts"] }
    - { id: "6.1", name: "Role briefings", type: "docs", phase: 6, depends_on: ["2.1"], files: ["briefings/front-desk.md", "briefings/architect.md", "briefings/developer.md", "test/briefings.test.ts"] }
    - { id: "6.2", name: "Plugin manifest, .mcp.json, user commands", type: "config", phase: 6, depends_on: ["2.1"], files: [".claude-plugin/plugin.json", ".mcp.json", "commands/front-desk.md", "commands/add-project.md", "commands/status.md", "commands/start-architect.md", "commands/stop-architect.md", "test/plugin-manifest.test.ts"] }
    - { id: "6.3", name: "Roster MCP tools + server + smoke test", type: "integration", phase: 6, depends_on: ["3.8", "4.5", "5.1", "6.1"], files: ["src/roster/tools.ts", "src/roster/server.ts", "test/server.test.ts"] }
    - { id: "7.1", name: "Full check, plugin validate, dev load, README, roster dump", type: "integration", phase: 7, depends_on: ["5.3", "6.2", "6.3"], files: ["README.md", "scripts/dump-roster.ts"] }
    - { id: "7.2", name: "Manual end-to-end (AC6), record e2e.md", type: "docs", phase: 7, depends_on: ["7.1"], files: ["conductor/tracks/core_20261021/e2e.md"] }

  parallel_groups:
    - { id: "pg-1", tasks: ["3.1", "4.1", "4.2", "4.3", "6.1", "6.2"], conflict_free: true }
    - { id: "pg-2", tasks: ["3.2", "4.4"], conflict_free: true }
    - { id: "pg-3", tasks: ["3.3", "3.4"], conflict_free: true }
    - { id: "pg-4", tasks: ["3.5", "3.6"], conflict_free: true }
    - { id: "pg-5", tasks: ["3.7", "4.5", "5.1"], conflict_free: true }
    - { id: "pg-6", tasks: ["3.8", "5.2"], conflict_free: true }
    - { id: "pg-7", tasks: ["5.3", "6.3"], conflict_free: true }
```

One line: `1.1 → 1.2 [GATE] → 2.1 → { 3.1→3.2→(3.3 ∥ 3.4)→(3.5 ∥ 3.6)→3.7→3.8 } ∥ { 4.1 ∥ 4.2 ∥ 4.3 → 4.4 → 4.5 } ∥ { 6.1 ∥ 6.2 } → 5.1 → 5.2 → 5.3 ; 6.3 (needs 3.8, 4.5, 5.1, 6.1) → 7.1 → 7.2`.

No two tasks in the same parallel group touch the same file. Two files are shared, but only in sequence: `test/helpers.ts` is created in 3.1 and only read afterwards, and `src/hooks/common.ts` is created in 5.1 and only read by 5.2 and 6.3.

---

## Phase 1: R0 spike (go/no-go gate)

Nothing else may start until Task 1.2 records **GO**.

### [ ] Task 1.1: Spike kit <!-- deps: none -->

- **Type**: config
- **Spec**: R0 (all steps), AC1
- **Acceptance**: the five kit files exist; `node --check` passes on each `.mjs`.

**Files:**
- Create: `conductor/tracks/core_20261021/spike/multi-manager.json`
- Create: `conductor/tracks/core_20261021/spike/spike-briefing.md`
- Create: `conductor/tracks/core_20261021/spike/spike-hook.mjs`
- Create: `conductor/tracks/core_20261021/spike/spike-env-mcp.mjs`
- Create: `conductor/tracks/core_20261021/spike/spike-launch.mjs`

**Step 1: Fragment** `conductor/tracks/core_20261021/spike/multi-manager.json`. Task 4.3 writes exactly this content, so keep the two identical:

```json
{
  "profiles": [
    {
      "name": "Multi-Manager",
      "commandline": "cmd.exe",
      "closeOnExit": "always",
      "suppressApplicationTitle": true
    }
  ]
}
```

**Step 2: Briefing** `conductor/tracks/core_20261021/spike/spike-briefing.md`. Its path contains spaces (`Dropbox (Personal)`), so it also tests how `wt.exe` quotes arguments:

```markdown
Your codename is HERON. If anyone asks for your codename, answer HERON.
```

**Step 3: SessionStart hook** `conductor/tracks/core_20261021/spike/spike-hook.mjs`. It writes evidence to a file and adds context:

```js
// Spike SessionStart hook: proves MM_* env from --settings reaches hooks.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const seen = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('MM_')));
writeFileSync(join(import.meta.dirname, 'spike-hook-env.json'), JSON.stringify(seen, null, 2));
process.stdout.write(`SessionStart hook saw: ${JSON.stringify(seen)}`);
```

**Step 4: Dependency-free MCP server** `conductor/tracks/core_20261021/spike/spike-env-mcp.mjs`:

```js
// Spike MCP server (stdio, no dependencies): proves MM_* env reaches MCP servers.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const seen = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('MM_')));
writeFileSync(join(import.meta.dirname, 'spike-mcp-env.json'), JSON.stringify(seen, null, 2));

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'spike-env', version: '0.0.1' } } });
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'show_env', description: 'Return the MM_* variables this MCP server process sees', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (message.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(seen) }] } });
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
});
```

**Step 5: Launcher** `conductor/tracks/core_20261021/spike/spike-launch.mjs`. It builds the same `wt.exe` command as R4, then looks for the pid in `~/.claude/sessions/*.json`:

```js
// Usage: node spike-launch.mjs "<scratch folder>" [session-name]
import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const [folder, name = 'mm-spike-main'] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node spike-launch.mjs "<scratch folder>" [session-name]');
  process.exit(2);
}
mkdirSync(folder, { recursive: true });

const settingsPath = join(here, 'spike-settings.json');
writeFileSync(settingsPath, JSON.stringify({
  env: { MM_ROLE: 'architect', MM_SESSION_ID: '9001', MM_PARENT_ID: '9000', MM_ROSTER_DB: join(here, 'spike-roster.db'), MM_VOICE: 'off' },
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: [join(here, 'spike-hook.mjs')] }] }] },
}, null, 2));
const mcpPath = join(here, 'spike-mcp.json');
writeFileSync(mcpPath, JSON.stringify({ mcpServers: { 'spike-env': { command: 'node', args: [join(here, 'spike-env-mcp.mjs')] } } }, null, 2));

const wt = join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe');
const prompt = 'Spike session. Reply with one line saying what your SessionStart hook context reported. Then wait. When another session messages you, reply to it with PONG followed by its text.';
const args = ['-w', 'multi-manager', 'new-tab', '--profile', 'Multi-Manager', '--title', name, '-d', folder,
  'claude', '-n', name, '--dangerously-skip-permissions',
  '--mcp-config', mcpPath,
  '--append-system-prompt-file', join(here, 'spike-briefing.md'),
  '--settings', settingsPath,
  prompt];

const started = Date.now();
execFile(wt, args, { windowsHide: true, timeout: 30_000 }, async (error, stdout, stderr) => {
  const result = { wt, args, exit: error ? (error.code ?? 1) : 0, error: error ? error.message : null, stdout, stderr, pid: null, sessionFile: null, candidates: [], waitedMs: 0 };
  const dir = join(homedir(), '.claude', 'sessions');
  for (let attempt = 0; attempt < 60 && result.pid === null; attempt += 1) {
    result.candidates = [];
    for (const file of readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))) {
      try {
        const session = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        result.candidates.push({ file, name: session.name, nameSource: session.nameSource, startedAt: session.startedAt, kind: session.kind });
        if (session.name === name && session.startedAt >= started - 1000) {
          result.pid = session.pid;
          result.sessionFile = session;
        }
      } catch {
        // file being written; try again next round
      }
    }
    if (result.pid === null) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  result.waitedMs = Date.now() - started;
  writeFileSync(join(here, 'spike-launch-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
});
```

**Step 6: Syntax check**

Run: `node --check conductor/tracks/core_20261021/spike/spike-launch.mjs` (and the same for `spike-hook.mjs` and `spike-env-mcp.mjs`).
Expected: no output, exit 0.

**Step 7: Commit**

```
git add conductor/tracks/core_20261021/spike
git commit -m "chore(spike): add R0 tab-launch spike kit" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 1.2: Run the spike and record `spike.md` (MANUAL, GATE) <!-- deps: 1.1 -->

- **Type**: docs (manual: a human, or an agent with the user watching)
- **Spec**: R0 steps 1–8, AC1. The spec's AC1 still says "four R0 steps". Read that as all eight revised steps.
- **Acceptance**: `conductor/tracks/core_20261021/spike.md` records PASS or FAIL with evidence for steps 1–8, and ends with **GO** or **NO-GO**. On NO-GO, stop the track: set `metadata.json` `status` to `"blocked"`, report to the user, and do not start Phase 2.

Use PowerShell for every step. In Git Bash, `taskkill /PID` gets mangled by path conversion; if you must use Git Bash, prefix the command with `MSYS_NO_PATHCONV=1`.

**Step 1 (R0.1): install the fragment.** Close every Windows Terminal window first, because fragments are read when Terminal starts. Run this from a plain PowerShell window:

```powershell
$dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\multi-manager'
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item 'I:\Dropbox (Personal)\Projects\multi-manager\conductor\tracks\core_20261021\spike\multi-manager.json' (Join-Path $dir 'multi-manager.json')
```
Then open Windows Terminal. Expected: the new-tab dropdown lists **Multi-Manager**.

**Step 2: start the spike front desk.** It needs the same permission mode as the spike session:

```powershell
cd 'I:\Dropbox (Personal)\Projects\multi-manager'
claude -n mm-spike-desk --dangerously-skip-permissions
```

**Step 3 (R0.2): launch the tab.** Inside the spike front desk, have it run this command through its shell tool (or run it from another PowerShell):

```powershell
node 'I:\Dropbox (Personal)\Projects\multi-manager\conductor\tracks\core_20261021\spike\spike-launch.mjs' "$env:TEMP\mm spike project" mm-spike-main
```
Expected: a Windows Terminal window named `multi-manager` opens a tab titled `mm-spike-main` running Claude Code in `%TEMP%\mm spike project`. The printed JSON shows `exit: 0` and a numeric `pid` found within about 10 s. Then check the exact command line Claude received, to confirm the quoting survived `wt.exe`:

```powershell
$p = (Get-Content 'I:\Dropbox (Personal)\Projects\multi-manager\conductor\tracks\core_20261021\spike\spike-launch-result.json' | ConvertFrom-Json).pid
Get-CimInstance Win32_Process -Filter "ProcessId=$p" | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-List
Get-CimInstance Win32_Process -Filter "ProcessId=$((Get-CimInstance Win32_Process -Filter "ProcessId=$p").ParentProcessId)" | Select-Object ProcessId, Name | Format-List
```
Expected: `Name` is `claude.exe`. `CommandLine` holds the briefing path, the settings path and the prompt, each intact as a single quoted argument. Record the parent process name, which shows what `taskkill /T` will leave behind.

**Step 4 (R0.3): ListAgents.** In the spike front desk, ask: "Call ListAgents and show me the raw result." Expected: an entry named `mm-spike-main`. Record the exact identifier it shows.

**Step 5 (R0.4): SendMessage round trip.** In the spike front desk, ask: "SendMessage to mm-spike-main: What is your codename?" Expected: a reply containing `HERON` reaches the front desk. Record how it arrives (pushed into the conversation, or only after waiting) and the exact `to` value used. Then test the reverse direction, which is the architect nudge path: in the spike tab type "Send a message to mm-spike-desk saying: check roster item #1". Expected: the front desk receives it.

**Step 6 (R0.5): type directly.** Switch to the `mm-spike-main` tab and type `Say hello in one word.` Expected: it answers. Then repeat Step 5's first message from the front desk with the text `ping 2`. Expected: `PONG ping 2` comes back.

**Step 7 (R0.6): env reaches hooks and MCP servers.**

```powershell
Get-Content 'I:\Dropbox (Personal)\Projects\multi-manager\conductor\tracks\core_20261021\spike\spike-hook-env.json'
Get-Content 'I:\Dropbox (Personal)\Projects\multi-manager\conductor\tracks\core_20261021\spike\spike-mcp-env.json'
```
Expected: both files contain `MM_ROLE: "architect"`, `MM_SESSION_ID: "9001"`, `MM_PARENT_ID: "9000"`, `MM_ROSTER_DB` and `MM_VOICE: "off"`. Also ask in the tab: "Run `echo $env:MM_ROLE` (PowerShell) or `echo $MM_ROLE` (bash) with your shell tool." Expected: `architect`.

**Step 8 (R0.7): kill the tree, and the tab closes completely.**

```powershell
taskkill /PID $p /T /F
Get-Process -Id $p -ErrorAction SilentlyContinue
Test-Path "$HOME\.claude\sessions\$p.json"
```
Expected: `SUCCESS` lines from taskkill. The `mm-spike-main` tab **disappears**, with no "process exited with code" text left behind. `Get-Process` returns nothing. Record whether the session file is left behind as a stale file (True or False). If it is, the stop path must not trust the file alone; Task 4.4 already double-checks the image name with `tasklist`.

**Step 9 (R0.8): pid lookup.** From `spike-launch-result.json`, record whether the session file's `name` equals the `-n` value, plus its `nameSource`, `kind`, and how long `waitedMs` was. If `name` does not match, record which field does. Task 4.2 must then be adjusted to that field, or fall back to walking `Win32_Process` parents from the `wt.exe`-launched process.

**Step 10: write `conductor/tracks/core_20261021/spike.md`** using this template:

```markdown
# R0 spike: tab launch and messaging

Date: 2026-10-__
Machine: Windows 11, Claude Code 2.1.306, Node v25.x, Windows Terminal 1.24.x
Run by: <name>

| # | Step (spec R0) | Result | Evidence |
|---|---|---|---|
| 1 | Fragment installs, "Multi-Manager" profile picked up | PASS/FAIL | |
| 2 | Tab opens in `multi-manager` window, Claude in the right folder; args intact (CommandLine) | PASS/FAIL | parent process: |
| 3 | Listed in front desk `ListAgents` under `-n` name | PASS/FAIL | identifier shown: |
| 4 | `SendMessage` round trip (front desk → tab → front desk), and tab → front desk nudge | PASS/FAIL | `to` value used: ; delivery: |
| 5 | User types in the tab; messaging still works after | PASS/FAIL | |
| 6 | `MM_*` from `--settings` env visible to hook, MCP server, shell | PASS/FAIL | hook: ; mcp: ; shell: |
| 7 | `taskkill /PID <pid> /T /F` closes the tab completely | PASS/FAIL | stale session file left: yes/no |
| 8 | Reliable pid lookup | PASS/FAIL | field matched: name/other; nameSource: ; waitedMs: |

## Raw `wt.exe` launch result
<paste spike-launch-result.json, trimming `candidates` to the matching entry>

## Notes for implementation
- Front-desk addressing for SendMessage: ...
- Anything that changes Tasks 4.1/4.2/4.4 (quoting, field names, timing): ...

## Decision
GO / NO-GO: <reason>
```

**Step 11: clean up and commit.** Delete `spike-roster.db*` if present, plus the scratch folder `%TEMP%\mm spike project`. Keep the result JSON files as evidence.

```
git add conductor/tracks/core_20261021/spike.md conductor/tracks/core_20261021/spike
git commit -m "docs(spike): record R0 tab-launch spike results" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

**Fallbacks to name in spike.md if a step fails.** These change the design, so the user decides; do not apply them silently.
- Arguments get mangled by `wt.exe`: write a per-session `.cmd` launcher and start that from `wt`. The tab root then becomes `cmd.exe`, and `/T` still kills the tree.
- `--settings` env does not reach the MCP server: add `"env": {"MM_SESSION_ID": "${MM_SESSION_ID:-}", ...}` to `.mcp.json` and retest.
- Messages are held: check that both sides run with `--dangerously-skip-permissions`. Try `"crossSessionInbound": "accept"` in the session's settings file (unverified setting).

---

## Phase 2: Tooling (R7)

### [ ] Task 2.1: package.json, tsconfig, ESLint, check.cmd <!-- deps: 1.2 -->

- **Type**: config
- **Spec**: R7, AC2
- **Acceptance**: `npm run check` prints a passing typecheck, lint and test run, and `.claude\check.cmd` exits 0.

> **CONFIRMATION POINT:** stop and ask the user before Step 3. R7 says tools are installed only "after the user approves installing the tools". The user approved the overall plan, but confirm the exact `npm install` lines below before running them.

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `test/toolchain.test.ts`
- Modify: `.claude/check.cmd` (replace the whole file)
- Generated: `package-lock.json`, `node_modules/` (ignored)

**Step 1: `package.json`**

```json
{
  "name": "multi-manager",
  "version": "0.1.0",
  "private": true,
  "description": "Claude Code plugin: one front desk directing architect sessions across projects",
  "type": "module",
  "engines": {
    "node": ">=25"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "node --test \"test/**/*.test.ts\"",
    "check": "npm run typecheck && npm run lint && npm run test"
  }
}
```

**Step 2: `tsconfig.json`, `eslint.config.js`, `.gitignore`**

```json
{
  "compilerOptions": {
    "target": "esnext",
    "lib": ["esnext"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "moduleDetection": "force",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": false,
    "skipLibCheck": true
  },
  "include": ["src", "scripts", "test"]
}
```

```js
// eslint.config.js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['node_modules/**', 'conductor/**', '.claude/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
);
```

```gitignore
node_modules/
*.db
*.db-wal
*.db-shm
```

**Step 3: install. Needs user confirmation (see above).**

```
npm install --save-exact @modelcontextprotocol/sdk@1.32.1 zod@4.6.7
npm install --save-dev --save-exact typescript@6.0.3 @types/node@25 eslint@10.13.0 @eslint/js@10.0.1 typescript-eslint@8.72.0
```
Expected: `added N packages`. typescript-eslint 8.72 needs TypeScript `<6.1.0`, which is why TypeScript is pinned to 6.0.3 and not 7.x. If npm reports that `@types/node@25` has no exact version, rerun the dev install with the version it lists, for example `@types/node@25.0.x`.

**Step 4: write the failing toolchain test** `test/toolchain.test.ts`:

```ts
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('runs on Node 25 or later with node:sqlite', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= 25, `Node ${process.versions.node} is too old`);
  const db = new DatabaseSync(':memory:');
  const row = db.prepare('SELECT 40 + 2 AS answer').get();
  db.close();
  assert.equal(row?.answer, 42);
});

test('TypeScript type stripping is active', () => {
  const typed: number = 1;
  assert.equal(typed, 1);
});
```

**Step 5: run it**

Run: `node --test test/toolchain.test.ts`
Expected: `ℹ pass 2` and `ℹ fail 0`. There is no separate "fail first" run: this test checks the toolchain, so if it fails the install itself is wrong.

**Step 6: replace `.claude/check.cmd`**

```bat
@echo off
rem Project check: type check, lint, tests (R7).
cd /d "%~dp0.."
call npm run check
exit /b %ERRORLEVEL%
```

**Step 7: run the check**

Run: `.claude\check.cmd` (PowerShell) or `cmd //c .claude\\check.cmd` (Git Bash)
Expected: `tsc` prints nothing, `eslint` prints nothing, and the test summary shows `ℹ fail 0`. Exit code 0.

**Step 8: commit**

```
git add package.json package-lock.json tsconfig.json eslint.config.js .gitignore .claude/check.cmd test/toolchain.test.ts
git commit -m "build: add TypeScript, ESLint and node:test toolchain" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
## Phase 3: Roster store (R2, AC3)

Every task in this phase follows the same red-green cycle. Write the test, then run `node --test test/<name>.test.ts`. It should fail with `ERR_MODULE_NOT_FOUND` for the new module, or with a missing export. Write the module, rerun the same command and expect `ℹ fail 0`, then run `npm run typecheck` and `npm run lint` (both silent), and commit.

### [ ] Task 3.1: Database module and test helpers <!-- deps: 2.1, parallel: pg-1 -->

- **Type**: code
- **Spec**: R2 (path, `MM_ROSTER_DB`, WAL, busy timeout, schema), AC3 ("Tests use a temporary database via `MM_ROSTER_DB`")
- **Acceptance**: `test/db.test.ts` passes: env override, default path, folder creation, WAL, busy timeout 5000, foreign keys on, all seven tables, and a second open is harmless.

**Files:** Create `src/roster/db.ts`, `test/helpers.ts`, `test/db.test.ts`

**Step 1: helpers** `test/helpers.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { openRoster } from '../src/roster/db.ts';

export function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

/** A fresh roster in a temp folder, opened through MM_ROSTER_DB as the spec requires. */
export function tempRoster(t: TestContext): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), 'mm-test-'));
  const previous = process.env.MM_ROSTER_DB;
  process.env.MM_ROSTER_DB = join(dir, 'roster.db');
  const db = openRoster();
  t.after(() => {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
    if (previous === undefined) delete process.env.MM_ROSTER_DB;
    else process.env.MM_ROSTER_DB = previous;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return db;
}

export function minutesBefore(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}
```

**Step 2: failing test** `test/db.test.ts`:

```ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openRoster, resolveDbPath } from '../src/roster/db.ts';
import { tempDir, tempRoster } from './helpers.ts';

const firstValue = (row: object | undefined): unknown => Object.values(row ?? {})[0];

test('resolveDbPath honours MM_ROSTER_DB', () => {
  assert.equal(resolveDbPath({ MM_ROSTER_DB: 'D:\\tmp\\roster.db' }), 'D:\\tmp\\roster.db');
});

test('resolveDbPath defaults to ~/.claude/multi-manager/roster.db', () => {
  const expected = join(homedir(), '.claude', 'multi-manager', 'roster.db');
  assert.equal(resolveDbPath({}), expected);
  assert.equal(resolveDbPath({ MM_ROSTER_DB: '' }), expected);
});

test('openRoster creates the folder and turns on WAL, busy timeout and foreign keys', (t) => {
  const path = join(tempDir(t), 'nested', 'deeper', 'roster.db');
  const db = openRoster(path);
  try {
    assert.ok(existsSync(path));
    assert.equal(firstValue(db.prepare('PRAGMA journal_mode').get()), 'wal');
    assert.equal(firstValue(db.prepare('PRAGMA busy_timeout').get()), 5000);
    assert.equal(firstValue(db.prepare('PRAGMA foreign_keys').get()), 1);
  } finally {
    db.close();
  }
});

test('the schema has every roster table and a second open is harmless', (t) => {
  const db = tempRoster(t);
  openRoster().close();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ['claims', 'goals', 'items', 'projects', 'sessions', 'spend', 'workstreams']);
});
```

**Step 3: run.** `node --test test/db.test.ts` should FAIL with `Cannot find module …src/roster/db.ts`.

**Step 4: implement** `src/roster/db.ts`:

```ts
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Env = Record<string, string | undefined>;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  folder TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  approval_rules TEXT NOT NULL,
  idle_stop_minutes INTEGER NOT NULL,
  daily_budget_usd REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workstreams (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL COLLATE NOCASE,
  branch TEXT NOT NULL,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('front-desk', 'architect', 'developer')),
  parent_id INTEGER REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  workstream_id INTEGER REFERENCES workstreams(id),
  name TEXT,
  pid INTEGER,
  folder TEXT,
  state TEXT NOT NULL CHECK (state IN ('running', 'stopped')),
  last_checkin_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_architect_per_workstream
  ON sessions (workstream_id) WHERE role = 'architect' AND state = 'running';
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  workstream_id INTEGER NOT NULL REFERENCES workstreams(id),
  text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('new', 'planning', 'awaiting-signoff', 'in-progress', 'done', 'cancelled')),
  budget_usd REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER REFERENCES goals(id),
  raised_by INTEGER REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('signoff', 'question', 'blocked', 'done', 'info')),
  body TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
  answer TEXT,
  addressed_to INTEGER NOT NULL REFERENCES sessions(id),
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL COLLATE NOCASE,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  claimed_at TEXT NOT NULL,
  UNIQUE (project_id, path)
);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  goal_id INTEGER REFERENCES goals(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  usd REAL NOT NULL,
  at TEXT NOT NULL
);
`;

export function resolveDbPath(env: Env = process.env): string {
  const override = env.MM_ROSTER_DB;
  if (override !== undefined && override !== '') return override;
  return join(homedir(), '.claude', 'multi-manager', 'roster.db');
}

export function openRoster(path: string = resolveDbPath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside BEGIN IMMEDIATE … COMMIT. Do not nest. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function iso(now: Date): string {
  return now.toISOString();
}

/** node:sqlite rows have a null prototype; copy them into plain objects. */
export function one<T>(row: unknown): T | undefined {
  return row === undefined ? undefined : ({ ...(row as object) } as T);
}

export function many<T>(rows: readonly unknown[]): T[] {
  return rows.map((row) => ({ ...(row as object) }) as T);
}
```

**Step 5: run.** `node --test test/db.test.ts` should PASS (`ℹ pass 4`). Then `npm run typecheck` and `npm run lint` should both be silent.

**Step 6: commit**

```
git add src/roster/db.ts test/helpers.ts test/db.test.ts
git commit -m "feat(roster): open shared SQLite roster with WAL and schema" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 3.2: Projects and workstreams <!-- deps: 3.1, parallel: pg-2 -->

- **Type**: code
- **Spec**: R2 Projects and Workstreams, AC3 ("project/workstream creation with defaults")
- **Acceptance**: `test/projects.test.ts` passes. The defaults match the spec word for word, `main` is created automatically, names are unique, and workstreams can be added later.

**Files:** Create `src/roster/projects.ts`, `test/projects.test.ts`

**Step 1: failing test** `test/projects.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_APPROVAL_RULES,
  DEFAULT_IDLE_STOP_MINUTES,
  addProject,
  addWorkstream,
  getProject,
  listProjects,
  listWorkstreams,
} from '../src/roster/projects.ts';
import { tempRoster } from './helpers.ts';

test('a new project gets the spec defaults and a main workstream', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha' });
  assert.equal(project.name, 'alpha');
  assert.equal(project.folder, 'C:\\work\\alpha');
  assert.equal(project.permission_mode, 'dangerously-skip-permissions');
  assert.equal(
    project.approval_rules,
    "User signs off on the high-level plan and the high-level testing approach: unit tests, end-to-end tests, and the architect's own browser click-through of every user-facing change to judge UI design and flow",
  );
  assert.equal(project.approval_rules, DEFAULT_APPROVAL_RULES);
  assert.equal(project.idle_stop_minutes, DEFAULT_IDLE_STOP_MINUTES);
  assert.equal(project.daily_budget_usd, null);
  assert.deepEqual(listWorkstreams(db, 'alpha').map((w) => [w.name, w.branch]), [['main', 'main']]);
});

test('settings and extra workstreams are stored; main may use another branch', (t) => {
  const db = tempRoster(t);
  addProject(db, {
    name: 'beta',
    folder: 'C:\\work\\beta',
    permissionMode: 'default',
    approvalRules: 'Sign off on everything',
    idleStopMinutes: 30,
    dailyBudgetUsd: 25,
    workstreams: [{ name: 'main', branch: 'master' }, { name: 'ui', branch: 'feature/ui' }],
  });
  const project = getProject(db, 'beta');
  assert.equal(project?.permission_mode, 'default');
  assert.equal(project?.approval_rules, 'Sign off on everything');
  assert.equal(project?.idle_stop_minutes, 30);
  assert.equal(project?.daily_budget_usd, 25);
  assert.deepEqual(listWorkstreams(db, 'beta').map((w) => [w.name, w.branch]), [['main', 'master'], ['ui', 'feature/ui']]);
});

test('project names are unique', (t) => {
  const db = tempRoster(t);
  addProject(db, { name: 'alpha', folder: 'C:\\a' });
  assert.throws(() => addProject(db, { name: 'alpha', folder: 'C:\\b' }), /Project "alpha" already exists/);
  assert.equal(listProjects(db).length, 1);
});

test('workstreams can be added later, once per name', (t) => {
  const db = tempRoster(t);
  addProject(db, { name: 'alpha', folder: 'C:\\a' });
  assert.equal(addWorkstream(db, 'alpha', { name: 'api', branch: 'feature/api' }).branch, 'feature/api');
  assert.throws(() => addWorkstream(db, 'alpha', { name: 'api', branch: 'x' }), /Workstream "api" already exists in alpha/);
  assert.throws(() => addWorkstream(db, 'nope', { name: 'api', branch: 'x' }), /Unknown project "nope"/);
});
```

**Step 2: run.** Expect FAIL (module not found).

**Step 3: implement** `src/roster/projects.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one, tx } from './db.ts';

export const DEFAULT_PERMISSION_MODE = 'dangerously-skip-permissions';
export const DEFAULT_APPROVAL_RULES =
  "User signs off on the high-level plan and the high-level testing approach: unit tests, end-to-end tests, and the architect's own browser click-through of every user-facing change to judge UI design and flow";
export const DEFAULT_IDLE_STOP_MINUTES = 120;
export const MAIN_WORKSTREAM = 'main';

export interface Project {
  id: number;
  name: string;
  folder: string;
  permission_mode: string;
  approval_rules: string;
  idle_stop_minutes: number;
  daily_budget_usd: number | null;
  created_at: string;
}

export interface Workstream {
  id: number;
  project_id: number;
  name: string;
  branch: string;
}

export interface WorkstreamInput {
  name: string;
  branch: string;
}

export interface ProjectInput {
  name: string;
  folder: string;
  permissionMode?: string;
  approvalRules?: string;
  idleStopMinutes?: number;
  dailyBudgetUsd?: number | null;
  workstreams?: WorkstreamInput[];
}

export function getProject(db: DatabaseSync, name: string): Project | undefined {
  return one<Project>(db.prepare('SELECT * FROM projects WHERE name = ?').get(name));
}

export function requireProject(db: DatabaseSync, name: string): Project {
  const project = getProject(db, name);
  if (project === undefined) throw new Error(`Unknown project "${name}"`);
  return project;
}

export function requireProjectById(db: DatabaseSync, id: number): Project {
  const project = one<Project>(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  if (project === undefined) throw new Error(`Unknown project #${id}`);
  return project;
}

export function listProjects(db: DatabaseSync): Project[] {
  return many<Project>(db.prepare('SELECT * FROM projects ORDER BY name').all());
}

function insertWorkstream(db: DatabaseSync, projectId: number, input: WorkstreamInput): void {
  db.prepare('INSERT INTO workstreams (project_id, name, branch) VALUES (?, ?, ?)').run(projectId, input.name, input.branch);
}

export function addProject(db: DatabaseSync, input: ProjectInput, now: Date = new Date()): Project {
  if (getProject(db, input.name) !== undefined) throw new Error(`Project "${input.name}" already exists`);
  return tx(db, () => {
    const result = db
      .prepare(
        `INSERT INTO projects (name, folder, permission_mode, approval_rules, idle_stop_minutes, daily_budget_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.folder,
        input.permissionMode ?? DEFAULT_PERMISSION_MODE,
        input.approvalRules ?? DEFAULT_APPROVAL_RULES,
        input.idleStopMinutes ?? DEFAULT_IDLE_STOP_MINUTES,
        input.dailyBudgetUsd ?? null,
        iso(now),
      );
    const projectId = Number(result.lastInsertRowid);
    const extra = input.workstreams ?? [];
    const main = extra.find((w) => w.name === MAIN_WORKSTREAM);
    insertWorkstream(db, projectId, { name: MAIN_WORKSTREAM, branch: main?.branch ?? MAIN_WORKSTREAM });
    for (const workstream of extra) {
      if (workstream.name !== MAIN_WORKSTREAM) insertWorkstream(db, projectId, workstream);
    }
    return requireProjectById(db, projectId);
  });
}

export function getWorkstream(db: DatabaseSync, projectId: number, name: string): Workstream | undefined {
  return one<Workstream>(db.prepare('SELECT * FROM workstreams WHERE project_id = ? AND name = ?').get(projectId, name));
}

export function requireWorkstream(db: DatabaseSync, projectId: number, name: string): Workstream {
  const workstream = getWorkstream(db, projectId, name);
  if (workstream === undefined) throw new Error(`Unknown workstream "${name}" in project #${projectId}`);
  return workstream;
}

export function requireWorkstreamById(db: DatabaseSync, id: number): Workstream {
  const workstream = one<Workstream>(db.prepare('SELECT * FROM workstreams WHERE id = ?').get(id));
  if (workstream === undefined) throw new Error(`Unknown workstream #${id}`);
  return workstream;
}

export function listWorkstreams(db: DatabaseSync, projectName: string): Workstream[] {
  const project = requireProject(db, projectName);
  return many<Workstream>(db.prepare('SELECT * FROM workstreams WHERE project_id = ? ORDER BY id').all(project.id));
}

export function addWorkstream(db: DatabaseSync, projectName: string, input: WorkstreamInput): Workstream {
  const project = requireProject(db, projectName);
  if (getWorkstream(db, project.id, input.name) !== undefined) {
    throw new Error(`Workstream "${input.name}" already exists in ${project.name}`);
  }
  insertWorkstream(db, project.id, input);
  return requireWorkstream(db, project.id, input.name);
}
```

**Step 4: run.** Expect PASS (`ℹ pass 4`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/projects.ts test/projects.test.ts
git commit -m "feat(roster): projects with defaults and workstreams" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 3.3: Sessions and the session tree <!-- deps: 3.2, parallel: pg-3 -->

- **Type**: code
- **Spec**: R2 Sessions (role, parent, project, workstream, `-n` name, pid, folder, state, check-in), R4 ("returns the existing one"), AC3 ("session tree")
- **Acceptance**: `test/sessions.test.ts` passes. There is a single front-desk row; the tree nests correctly and prunes stopped leaves; check-in updates the time; only one running architect is allowed per workstream.

**Files:** Create `src/roster/sessions.ts`, `test/sessions.test.ts`

**Step 1: failing test** `test/sessions.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import {
  checkIn,
  frontDesk,
  registerSession,
  runningArchitect,
  runningChildren,
  sessionTree,
  setSessionPid,
  setSessionState,
  startFrontDesk,
} from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function setup(t: TestContext) {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  return { db, project, main: requireWorkstream(db, project.id, 'main'), ui: requireWorkstream(db, project.id, 'ui') };
}

test('there is one front-desk record, created on demand and reused on start', (t) => {
  const { db } = setup(t);
  const placeholder = frontDesk(db);
  assert.equal(placeholder.state, 'stopped');
  assert.equal(frontDesk(db).id, placeholder.id);
  const started = startFrontDesk(db, 'mm-front-desk');
  assert.equal(started.id, placeholder.id);
  assert.equal(started.state, 'running');
  assert.equal(started.name, 'mm-front-desk');
});

test('the session tree nests by parent and hides stopped leaves unless asked', (t) => {
  const { db, project, main, ui } = setup(t);
  const desk = startFrontDesk(db);
  const archMain = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const archUi = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: ui.id, name: 'mm-alpha-ui' });
  const dev = registerSession(db, { role: 'developer', parentId: archMain.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main-dev-login' });
  const tree = sessionTree(db);
  assert.deepEqual(tree.map((n) => n.id), [desk.id]);
  assert.deepEqual(tree[0].children.map((n) => n.id), [archMain.id, archUi.id]);
  assert.deepEqual(tree[0].children[0].children.map((n) => n.id), [dev.id]);
  setSessionState(db, dev.id, 'stopped');
  assert.deepEqual(sessionTree(db)[0].children[0].children, []);
  assert.deepEqual(sessionTree(db, { includeStopped: true })[0].children[0].children.map((n) => n.id), [dev.id]);
  assert.deepEqual(runningChildren(db, archMain.id), []);
});

test('check-in records the time; unknown sessions are rejected', (t) => {
  const { db } = setup(t);
  const desk = startFrontDesk(db);
  const at = new Date('2026-10-21T10:00:00.000Z');
  assert.equal(checkIn(db, desk.id, at).last_checkin_at, '2026-10-21T10:00:00.000Z');
  assert.throws(() => checkIn(db, 999), /Unknown session #999/);
});

test('one running architect per workstream; pid is stored', (t) => {
  const { db, project, main } = setup(t);
  const arch = registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  setSessionPid(db, arch.id, 4242);
  assert.equal(runningArchitect(db, main.id)?.pid, 4242);
  assert.throws(() => registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'again' }), /UNIQUE/);
  setSessionState(db, arch.id, 'stopped');
  assert.equal(runningArchitect(db, main.id), undefined);
  registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/roster/sessions.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from './db.ts';

export const ROLES = ['front-desk', 'architect', 'developer'] as const;
export type Role = (typeof ROLES)[number];
export type SessionState = 'running' | 'stopped';
export const FRONT_DESK_NAME = 'mm-front-desk';

export interface Session {
  id: number;
  role: Role;
  parent_id: number | null;
  project_id: number | null;
  workstream_id: number | null;
  name: string | null;
  pid: number | null;
  folder: string | null;
  state: SessionState;
  last_checkin_at: string | null;
  created_at: string;
}

export interface SessionNode extends Session {
  children: SessionNode[];
}

export interface SessionInput {
  role: Role;
  parentId?: number | null;
  projectId?: number | null;
  workstreamId?: number | null;
  name?: string | null;
  pid?: number | null;
  folder?: string | null;
  state?: SessionState;
}

export function registerSession(db: DatabaseSync, input: SessionInput, now: Date = new Date()): Session {
  const result = db
    .prepare(
      `INSERT INTO sessions (role, parent_id, project_id, workstream_id, name, pid, folder, state, last_checkin_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.role,
      input.parentId ?? null,
      input.projectId ?? null,
      input.workstreamId ?? null,
      input.name ?? null,
      input.pid ?? null,
      input.folder ?? null,
      input.state ?? 'running',
      iso(now),
      iso(now),
    );
  return requireSession(db, Number(result.lastInsertRowid));
}

export function getSession(db: DatabaseSync, id: number): Session | undefined {
  return one<Session>(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
}

export function requireSession(db: DatabaseSync, id: number): Session {
  const session = getSession(db, id);
  if (session === undefined) throw new Error(`Unknown session #${id}`);
  return session;
}

export function checkIn(db: DatabaseSync, id: number, now: Date = new Date()): Session {
  requireSession(db, id);
  db.prepare('UPDATE sessions SET last_checkin_at = ? WHERE id = ?').run(iso(now), id);
  return requireSession(db, id);
}

export function setSessionState(db: DatabaseSync, id: number, state: SessionState): void {
  db.prepare('UPDATE sessions SET state = ? WHERE id = ?').run(state, id);
}

export function setSessionPid(db: DatabaseSync, id: number, pid: number | null): void {
  db.prepare('UPDATE sessions SET pid = ? WHERE id = ?').run(pid, id);
}

/** The single front-desk record; created (stopped) if missing. More than one front desk is out of scope. */
export function frontDesk(db: DatabaseSync, now: Date = new Date()): Session {
  const existing = one<Session>(db.prepare("SELECT * FROM sessions WHERE role = 'front-desk' ORDER BY id LIMIT 1").get());
  if (existing !== undefined) return existing;
  return registerSession(db, { role: 'front-desk', name: FRONT_DESK_NAME, state: 'stopped' }, now);
}

export function startFrontDesk(db: DatabaseSync, name: string = FRONT_DESK_NAME, now: Date = new Date()): Session {
  const desk = frontDesk(db, now);
  db.prepare("UPDATE sessions SET state = 'running', name = ?, last_checkin_at = ? WHERE id = ?").run(name, iso(now), desk.id);
  return requireSession(db, desk.id);
}

export function runningArchitect(db: DatabaseSync, workstreamId: number): Session | undefined {
  return one<Session>(
    db.prepare("SELECT * FROM sessions WHERE role = 'architect' AND state = 'running' AND workstream_id = ?").get(workstreamId),
  );
}

export function runningChildren(db: DatabaseSync, parentId: number): Session[] {
  return many<Session>(db.prepare("SELECT * FROM sessions WHERE parent_id = ? AND state = 'running' ORDER BY id").all(parentId));
}

export function sessionTree(db: DatabaseSync, options: { includeStopped?: boolean } = {}): SessionNode[] {
  const all = many<Session>(db.prepare('SELECT * FROM sessions ORDER BY id').all());
  const nodes = new Map<number, SessionNode>(all.map((s) => [s.id, { ...s, children: [] }]));
  const roots: SessionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? undefined : nodes.get(node.parent_id);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  if (options.includeStopped === true) return roots;
  const prune = (list: SessionNode[]): SessionNode[] =>
    list.flatMap((node) => {
      node.children = prune(node.children);
      return node.state === 'running' || node.children.length > 0 ? [node] : [];
    });
  return prune(roots);
}
```

**Step 4: run.** Expect PASS (`ℹ pass 4`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/sessions.ts test/sessions.test.ts
git commit -m "feat(roster): sessions, front desk record and session tree" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 3.4: Goals <!-- deps: 3.2, parallel: pg-3 -->

- **Type**: code
- **Spec**: R2 Goals, AC3 ("goal state changes")
- **Acceptance**: `test/goals.test.ts` passes. Goals start as `new`, move through the states, reject unknown states, and refuse changes once done or cancelled; the active-goal list excludes finished goals.

**Files:** Create `src/roster/goals.ts`, `test/goals.test.ts`

**Step 1: failing test** `test/goals.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeGoals, createGoal, goalWithPlace, updateGoal, type GoalState } from '../src/roster/goals.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { tempRoster } from './helpers.ts';

test('goals start new and move through their states', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const created = createGoal(db, { workstreamId: main.id, text: 'Add a login page', budgetUsd: 5 }, new Date('2026-10-21T09:00:00.000Z'));
  assert.equal(created.state, 'new');
  assert.equal(created.budget_usd, 5);
  const steps: GoalState[] = ['planning', 'awaiting-signoff', 'in-progress', 'done'];
  let minute = 1;
  for (const state of steps) {
    const at = new Date(`2026-10-21T09:0${minute}:00.000Z`);
    const updated = updateGoal(db, created.id, { state }, at);
    assert.equal(updated.state, state);
    assert.equal(updated.updated_at, at.toISOString());
    minute += 1;
  }
  assert.throws(() => updateGoal(db, created.id, { state: 'planning' }), /Goal #\d+ is done and cannot change/);
});

test('unknown states and empty text are rejected', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const goal = createGoal(db, { workstreamId: main.id, text: 'x' });
  assert.throws(() => updateGoal(db, goal.id, { state: 'paused' as GoalState }), /Unknown goal state "paused"/);
  assert.throws(() => createGoal(db, { workstreamId: main.id, text: '   ' }), /A goal needs some text/);
});

test('active goals exclude done and cancelled, and carry project and workstream names', (t) => {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  const ui = requireWorkstream(db, project.id, 'ui');
  const keep = createGoal(db, { workstreamId: ui.id, text: 'keep' });
  const done = createGoal(db, { workstreamId: ui.id, text: 'done' });
  const cancelled = createGoal(db, { workstreamId: ui.id, text: 'cancelled' });
  updateGoal(db, done.id, { state: 'done' });
  updateGoal(db, cancelled.id, { state: 'cancelled' });
  assert.deepEqual(activeGoals(db, project.id).map((g) => [g.id, g.project, g.workstream]), [[keep.id, 'alpha', 'ui']]);
  assert.equal(goalWithPlace(db, done.id).project_id, project.id);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/roster/goals.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from './db.ts';

export const GOAL_STATES = ['new', 'planning', 'awaiting-signoff', 'in-progress', 'done', 'cancelled'] as const;
export type GoalState = (typeof GOAL_STATES)[number];
const FINISHED: readonly string[] = ['done', 'cancelled'];

export interface Goal {
  id: number;
  workstream_id: number;
  text: string;
  state: GoalState;
  budget_usd: number | null;
  created_at: string;
  updated_at: string;
}

export interface GoalWithPlace extends Goal {
  project_id: number;
  project: string;
  workstream: string;
}

export interface GoalInput {
  workstreamId: number;
  text: string;
  budgetUsd?: number | null;
}

export interface GoalChange {
  state?: GoalState;
  text?: string;
  budgetUsd?: number | null;
}

const WITH_PLACE = `SELECT g.*, p.id AS project_id, p.name AS project, w.name AS workstream
  FROM goals g JOIN workstreams w ON w.id = g.workstream_id JOIN projects p ON p.id = w.project_id`;

export function createGoal(db: DatabaseSync, input: GoalInput, now: Date = new Date()): Goal {
  if (input.text.trim() === '') throw new Error('A goal needs some text');
  const result = db
    .prepare('INSERT INTO goals (workstream_id, text, state, budget_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.workstreamId, input.text, 'new', input.budgetUsd ?? null, iso(now), iso(now));
  return requireGoal(db, Number(result.lastInsertRowid));
}

export function getGoal(db: DatabaseSync, id: number): Goal | undefined {
  return one<Goal>(db.prepare('SELECT * FROM goals WHERE id = ?').get(id));
}

export function requireGoal(db: DatabaseSync, id: number): Goal {
  const goal = getGoal(db, id);
  if (goal === undefined) throw new Error(`Unknown goal #${id}`);
  return goal;
}

export function goalWithPlace(db: DatabaseSync, id: number): GoalWithPlace {
  const goal = one<GoalWithPlace>(db.prepare(`${WITH_PLACE} WHERE g.id = ?`).get(id));
  if (goal === undefined) throw new Error(`Unknown goal #${id}`);
  return goal;
}

export function updateGoal(db: DatabaseSync, id: number, change: GoalChange, now: Date = new Date()): Goal {
  const goal = requireGoal(db, id);
  if (change.state !== undefined && !(GOAL_STATES as readonly string[]).includes(change.state)) {
    throw new Error(`Unknown goal state "${change.state}"`);
  }
  if (FINISHED.includes(goal.state)) throw new Error(`Goal #${id} is ${goal.state} and cannot change`);
  db.prepare('UPDATE goals SET state = ?, text = ?, budget_usd = ?, updated_at = ? WHERE id = ?').run(
    change.state ?? goal.state,
    change.text ?? goal.text,
    change.budgetUsd === undefined ? goal.budget_usd : change.budgetUsd,
    iso(now),
    id,
  );
  return requireGoal(db, id);
}

export function activeGoals(db: DatabaseSync, projectId: number): GoalWithPlace[] {
  return many<GoalWithPlace>(
    db.prepare(`${WITH_PLACE} WHERE p.id = ? AND g.state NOT IN ('done', 'cancelled') ORDER BY g.id`).all(projectId),
  );
}
```

**Step 4: run.** Expect PASS (`ℹ pass 3`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/goals.ts test/goals.test.ts
git commit -m "feat(roster): goals and their states" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 3.5: Items (escalations and notes) <!-- deps: 3.3, 3.4, parallel: pg-4 -->

- **Type**: code
- **Spec**: R2 Items, AC3 ("item raise → answer stores the answer verbatim; unseen-item marking"), R6 front desk ("record the user's sign-offs and answers verbatim")
- **Acceptance**: `test/items.test.ts` passes. Items go to the raiser's parent by default, otherwise the front desk. An answer is stored byte for byte, readdressed to the raiser and marked unseen, and can only be given once. Seen marking and the filters work.

**Files:** Create `src/roster/items.ts`, `test/items.test.ts`

**Step 1: failing test** `test/items.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createGoal } from '../src/roster/goals.ts';
import {
  answerItem,
  closeItem,
  formatItem,
  listItems,
  markSeen,
  openItemsFor,
  raiseItem,
  unseenItemsFor,
} from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const goal = createGoal(db, { workstreamId: main.id, text: 'Login page' });
  return { db, desk, arch, goal };
}

test("an item goes to the raiser's parent, or to the front desk", (t) => {
  const { db, desk, arch, goal } = setup(t);
  const signoff = raiseItem(db, { kind: 'signoff', body: 'Plan: …', goalId: goal.id, raisedBy: arch.id });
  assert.equal(signoff.addressed_to, desk.id);
  assert.equal(signoff.state, 'open');
  assert.equal(signoff.seen, 0);
  const system = raiseItem(db, { kind: 'info', body: 'no raiser' });
  assert.equal(system.addressed_to, desk.id);
});

test("answering stores the user's words verbatim and hands the item back unseen", (t) => {
  const { db, desk, arch, goal } = setup(t);
  const item = raiseItem(db, { kind: 'signoff', body: 'Plan and testing approach', goalId: goal.id, raisedBy: arch.id });
  markSeen(db, [item.id]);
  const words = '  Approved — go ahead; keep it to one file.\n"Use Playwright" for the click-through 🚀  ';
  const answered = answerItem(db, item.id, words, new Date('2026-10-21T12:00:00.000Z'));
  assert.equal(answered.answer, words);
  assert.equal(answered.state, 'answered');
  assert.equal(answered.addressed_to, arch.id);
  assert.equal(answered.seen, 0);
  assert.equal(answered.answered_at, '2026-10-21T12:00:00.000Z');
  assert.notEqual(answered.addressed_to, desk.id);
  assert.throws(() => answerItem(db, item.id, 'again'), /Item #\d+ is answered, not open/);
});

test('unseen items are listed until marked seen; closed items drop out', (t) => {
  const { db, desk, arch, goal } = setup(t);
  const a = raiseItem(db, { kind: 'question', body: 'A?', goalId: goal.id, raisedBy: arch.id });
  const b = raiseItem(db, { kind: 'blocked', body: 'B', raisedBy: arch.id });
  assert.deepEqual(unseenItemsFor(db, desk.id).map((i) => i.id), [a.id, b.id]);
  markSeen(db, [a.id]);
  assert.deepEqual(unseenItemsFor(db, desk.id).map((i) => i.id), [b.id]);
  assert.deepEqual(openItemsFor(db, desk.id).map((i) => i.id), [a.id, b.id]);
  closeItem(db, b.id);
  assert.deepEqual(openItemsFor(db, desk.id).map((i) => i.id), [a.id]);
  assert.deepEqual(listItems(db, { goalId: goal.id }).map((i) => i.id), [a.id]);
  assert.deepEqual(listItems(db, { states: ['closed'] }).map((i) => i.id), [b.id]);
});

test('formatItem shows id, kind, state, goal, body and the verbatim answer', (t) => {
  const { db, arch, goal } = setup(t);
  const item = raiseItem(db, { kind: 'signoff', body: 'Plan v1', goalId: goal.id, raisedBy: arch.id });
  const text = formatItem(answerItem(db, item.id, 'Yes, but no new deps.'));
  assert.equal(text, `#${item.id} [signoff, answered, goal #${goal.id}] Plan v1\n  Answer (verbatim): Yes, but no new deps.`);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/roster/items.ts`:

```ts
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { iso, many, one } from './db.ts';
import { frontDesk, requireSession } from './sessions.ts';

export const ITEM_KINDS = ['signoff', 'question', 'blocked', 'done', 'info'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_STATES = ['open', 'answered', 'closed'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
const LIVE: readonly ItemState[] = ['open', 'answered'];

export interface Item {
  id: number;
  goal_id: number | null;
  raised_by: number | null;
  kind: ItemKind;
  body: string;
  state: ItemState;
  answer: string | null;
  addressed_to: number;
  seen: number;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
}

export interface ItemInput {
  kind: ItemKind;
  body: string;
  goalId?: number | null;
  raisedBy?: number | null;
  addressedTo?: number | null;
}

export interface ItemFilter {
  addressedTo?: number;
  states?: readonly ItemState[];
  unseenOnly?: boolean;
  goalId?: number;
}

function defaultAddressee(db: DatabaseSync, raisedBy: number | null, now: Date): number {
  if (raisedBy !== null) {
    const raiser = requireSession(db, raisedBy);
    if (raiser.parent_id !== null) return raiser.parent_id;
  }
  return frontDesk(db, now).id;
}

export function raiseItem(db: DatabaseSync, input: ItemInput, now: Date = new Date()): Item {
  if (!(ITEM_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Unknown item kind "${input.kind}"`);
  if (input.body.trim() === '') throw new Error('An item needs a body');
  const raisedBy = input.raisedBy ?? null;
  const addressedTo = input.addressedTo ?? defaultAddressee(db, raisedBy, now);
  const result = db
    .prepare(
      `INSERT INTO items (goal_id, raised_by, kind, body, state, addressed_to, seen, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, 0, ?, ?)`,
    )
    .run(input.goalId ?? null, raisedBy, input.kind, input.body, addressedTo, iso(now), iso(now));
  return requireItem(db, Number(result.lastInsertRowid));
}

export function getItem(db: DatabaseSync, id: number): Item | undefined {
  return one<Item>(db.prepare('SELECT * FROM items WHERE id = ?').get(id));
}

export function requireItem(db: DatabaseSync, id: number): Item {
  const item = getItem(db, id);
  if (item === undefined) throw new Error(`Unknown item #${id}`);
  return item;
}

/** Stores the user's answer exactly as given (no trimming) and hands the item back to its raiser, unseen. */
export function answerItem(db: DatabaseSync, id: number, answer: string, now: Date = new Date()): Item {
  const item = requireItem(db, id);
  if (item.state !== 'open') throw new Error(`Item #${id} is ${item.state}, not open`);
  db.prepare(
    `UPDATE items SET state = 'answered', answer = ?, answered_at = ?, updated_at = ?, addressed_to = ?, seen = 0 WHERE id = ?`,
  ).run(answer, iso(now), iso(now), item.raised_by ?? item.addressed_to, id);
  return requireItem(db, id);
}

export function closeItem(db: DatabaseSync, id: number, now: Date = new Date()): Item {
  requireItem(db, id);
  db.prepare("UPDATE items SET state = 'closed', updated_at = ? WHERE id = ?").run(iso(now), id);
  return requireItem(db, id);
}

export function listItems(db: DatabaseSync, filter: ItemFilter = {}): Item[] {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.addressedTo !== undefined) {
    where.push('addressed_to = ?');
    params.push(filter.addressedTo);
  }
  if (filter.states !== undefined && filter.states.length > 0) {
    where.push(`state IN (${filter.states.map(() => '?').join(', ')})`);
    params.push(...filter.states);
  }
  if (filter.unseenOnly === true) where.push('seen = 0');
  if (filter.goalId !== undefined) {
    where.push('goal_id = ?');
    params.push(filter.goalId);
  }
  const sql = `SELECT * FROM items${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
  return many<Item>(db.prepare(sql).all(...params));
}

export function markSeen(db: DatabaseSync, ids: readonly number[]): void {
  const statement = db.prepare('UPDATE items SET seen = 1 WHERE id = ?');
  for (const id of ids) statement.run(id);
}

export function openItemsFor(db: DatabaseSync, sessionId: number): Item[] {
  return listItems(db, { addressedTo: sessionId, states: LIVE });
}

export function unseenItemsFor(db: DatabaseSync, sessionId: number): Item[] {
  return listItems(db, { addressedTo: sessionId, states: LIVE, unseenOnly: true });
}

export function formatItem(item: Item): string {
  const goal = item.goal_id === null ? '' : `, goal #${item.goal_id}`;
  const head = `#${item.id} [${item.kind}, ${item.state}${goal}] ${item.body}`;
  return item.answer === null ? head : `${head}\n  Answer (verbatim): ${item.answer}`;
}
```

**Step 4: run.** Expect PASS (`ℹ pass 4`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/items.ts test/items.test.ts
git commit -m "feat(roster): items with verbatim answers and seen marking" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 3.6: Claims <!-- deps: 3.3, parallel: pg-4 -->

- **Type**: code
- **Spec**: R2 Claims, AC3 ("claim refusal naming the holder")
- **Acceptance**: `test/claims.test.ts` passes. A second claim is refused and the refusal names the holder. Paths are compared case-insensitively with slashes normalised. Only the holder can release, and `releaseAll` frees everything a session holds.

**Files:** Create `src/roster/claims.ts`, `test/claims.test.ts`

**Step 1: failing test** `test/claims.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { claim, listClaims, release, releaseAll } from '../src/roster/claims.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function setup(t: TestContext) {
  const db = tempRoster(t);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  const main = requireWorkstream(db, project.id, 'main');
  const ui = requireWorkstream(db, project.id, 'ui');
  const a = registerSession(db, { role: 'architect', projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const b = registerSession(db, { role: 'architect', projectId: project.id, workstreamId: ui.id, name: 'mm-alpha-ui' });
  return { db, project, a, b };
}

test('a second claim is refused and names the holder', (t) => {
  const { db, project, a, b } = setup(t);
  assert.deepEqual(claim(db, project.id, 'package.json', a.id, new Date('2026-10-21T08:00:00.000Z')), { ok: true, path: 'package.json' });
  assert.deepEqual(claim(db, project.id, 'package.json', a.id), { ok: true, path: 'package.json' });
  const refused = claim(db, project.id, '.\\PACKAGE.json', b.id);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.holder.name, 'mm-alpha-main');
  assert.equal(refused.holder.session_id, a.id);
  assert.match(refused.message, /package\.json is claimed by mm-alpha-main \(session #\d+, architect\) since 2026-10-21T08:00:00\.000Z/);
});

test("only the holder releases; releaseAll frees a session's claims", (t) => {
  const { db, project, a, b } = setup(t);
  claim(db, project.id, 'src\\shared\\schema.ts', a.id);
  claim(db, project.id, 'build:heavy', a.id);
  assert.deepEqual(listClaims(db, project.id).map((c) => c.path), ['src/shared/schema.ts', 'build:heavy']);
  assert.equal(release(db, project.id, 'src/shared/schema.ts', b.id), false);
  assert.equal(release(db, project.id, 'src/shared/schema.ts', a.id), true);
  assert.equal(claim(db, project.id, 'src/shared/schema.ts', b.id).ok, true);
  assert.equal(releaseAll(db, a.id), 1);
  assert.deepEqual(listClaims(db, project.id).map((c) => c.path), ['src/shared/schema.ts']);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/roster/claims.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { iso, many, one } from './db.ts';
import type { Role } from './sessions.ts';

export interface Claim {
  id: number;
  project_id: number;
  path: string;
  session_id: number;
  claimed_at: string;
}

export interface ClaimHolder {
  session_id: number;
  name: string | null;
  role: Role;
  claimed_at: string;
}

export type ClaimResult =
  | { ok: true; path: string }
  | { ok: false; path: string; holder: ClaimHolder; message: string };

/** File paths or heavy-job names: backslashes become slashes and a leading ./ is dropped. The column ignores case. */
export function normaliseClaimPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function claim(db: DatabaseSync, projectId: number, path: string, sessionId: number, now: Date = new Date()): ClaimResult {
  const normalised = normaliseClaimPath(path);
  db.prepare('INSERT OR IGNORE INTO claims (project_id, path, session_id, claimed_at) VALUES (?, ?, ?, ?)').run(
    projectId,
    normalised,
    sessionId,
    iso(now),
  );
  const holder = one<ClaimHolder & { path: string }>(
    db
      .prepare(
        `SELECT c.session_id, c.path, s.name, s.role, c.claimed_at FROM claims c JOIN sessions s ON s.id = c.session_id
         WHERE c.project_id = ? AND c.path = ?`,
      )
      .get(projectId, normalised),
  );
  if (holder === undefined) throw new Error(`Could not claim ${normalised}`);
  if (holder.session_id === sessionId) return { ok: true, path: holder.path };
  return {
    ok: false,
    path: holder.path,
    holder: { session_id: holder.session_id, name: holder.name, role: holder.role, claimed_at: holder.claimed_at },
    message: `${holder.path} is claimed by ${holder.name ?? 'an unnamed session'} (session #${holder.session_id}, ${holder.role}) since ${holder.claimed_at}`,
  };
}

export function release(db: DatabaseSync, projectId: number, path: string, sessionId: number): boolean {
  const result = db
    .prepare('DELETE FROM claims WHERE project_id = ? AND path = ? AND session_id = ?')
    .run(projectId, normaliseClaimPath(path), sessionId);
  return Number(result.changes) > 0;
}

export function releaseAll(db: DatabaseSync, sessionId: number): number {
  return Number(db.prepare('DELETE FROM claims WHERE session_id = ?').run(sessionId).changes);
}

export function listClaims(db: DatabaseSync, projectId: number): Claim[] {
  return many<Claim>(db.prepare('SELECT * FROM claims WHERE project_id = ? ORDER BY id').all(projectId));
}
```

**Step 4: run.** Expect PASS (`ℹ pass 2`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/claims.ts test/claims.test.ts
git commit -m "feat(roster): file and heavy-job claims naming the holder" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 3.7: Spend and budgets <!-- deps: 3.5, parallel: pg-5 -->

- **Type**: code
- **Spec**: R2 Spend ("Over-budget (goal or project daily) raises an info/blocked item to the front desk"), AC3 ("spend over budget raising an item")
- **Acceptance**: `test/spend.test.ts` passes. Crossing a goal budget raises one `blocked` item to the front desk, and crossing the project's daily budget raises one `info` item. Neither is raised again on later spend. Yesterday's spend (UTC) does not count, and negative amounts are rejected.

**Files:** Create `src/roster/spend.ts`, `test/spend.test.ts`

**Step 1: failing test** `test/spend.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createGoal } from '../src/roster/goals.ts';
import { listItems } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { reportSpend, spendForGoal, spendToday } from '../src/roster/spend.ts';
import { tempRoster } from './helpers.ts';

const at = (time: string) => new Date(`2026-10-21T${time}:00.000Z`);

function setup(t: TestContext, dailyBudgetUsd: number | null) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a', dailyBudgetUsd });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  return { db, desk, project, main, arch };
}

test('crossing a goal budget raises one blocked item to the front desk', (t) => {
  const { db, desk, main, arch } = setup(t, null);
  const goal = createGoal(db, { workstreamId: main.id, text: 'g', budgetUsd: 5 });
  assert.deepEqual(reportSpend(db, { usd: 3, sessionId: arch.id, goalId: goal.id }, at('09:00')).raised, []);
  const crossing = reportSpend(db, { usd: 3, sessionId: arch.id, goalId: goal.id }, at('10:00'));
  assert.equal(crossing.raised.length, 1);
  assert.equal(crossing.raised[0].kind, 'blocked');
  assert.equal(crossing.raised[0].addressed_to, desk.id);
  assert.equal(crossing.raised[0].goal_id, goal.id);
  assert.match(crossing.raised[0].body, /Goal #\d+ is over budget: \$6\.00 spent of \$5\.00/);
  assert.deepEqual(reportSpend(db, { usd: 1, sessionId: arch.id, goalId: goal.id }, at('11:00')).raised, []);
  assert.equal(spendForGoal(db, goal.id), 7);
});

test('crossing the project daily budget raises one info item; yesterday does not count', (t) => {
  const { db, desk, project, arch } = setup(t, 10);
  reportSpend(db, { usd: 9, sessionId: arch.id }, new Date('2026-10-20T23:30:00.000Z'));
  assert.deepEqual(reportSpend(db, { usd: 6, sessionId: arch.id }, at('01:00')).raised, []);
  const crossing = reportSpend(db, { usd: 5, sessionId: arch.id }, at('02:00'));
  assert.equal(crossing.raised.length, 1);
  assert.equal(crossing.raised[0].kind, 'info');
  assert.equal(crossing.raised[0].addressed_to, desk.id);
  assert.match(crossing.raised[0].body, /Project alpha is over its daily budget: \$11\.00 spent today \(UTC\) of \$10\.00/);
  assert.equal(spendToday(db, project.id, at('03:00')), 11);
  assert.equal(listItems(db, { addressedTo: desk.id }).length, 1);
});

test('spend needs a project and a non-negative amount', (t) => {
  const { db, project } = setup(t, null);
  assert.throws(() => reportSpend(db, { usd: -1, projectId: project.id }), /non-negative/);
  assert.throws(() => reportSpend(db, { usd: 1 }), /Cannot tell which project/);
  assert.equal(reportSpend(db, { usd: 1, projectId: project.id }).project_id, project.id);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/roster/spend.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { iso, tx } from './db.ts';
import { goalWithPlace, requireGoal } from './goals.ts';
import { raiseItem, type Item } from './items.ts';
import { requireProjectById } from './projects.ts';
import { frontDesk, requireSession } from './sessions.ts';

export interface SpendInput {
  usd: number;
  sessionId?: number | null;
  goalId?: number | null;
  projectId?: number | null;
}

export interface SpendResult {
  id: number;
  project_id: number;
  goal_total_usd: number | null;
  project_today_usd: number;
  raised: Item[];
}

/** Spend days are UTC calendar days. */
export function utcDay(now: Date): string {
  return iso(now).slice(0, 10);
}

export function spendToday(db: DatabaseSync, projectId: number, now: Date = new Date()): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE project_id = ? AND substr(at, 1, 10) = ?')
    .get(projectId, utcDay(now));
  return Number(row?.total ?? 0);
}

export function spendForGoal(db: DatabaseSync, goalId: number): number {
  const row = db.prepare('SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE goal_id = ?').get(goalId);
  return Number(row?.total ?? 0);
}

function spendProject(db: DatabaseSync, input: SpendInput): number {
  if (input.projectId != null) return requireProjectById(db, input.projectId).id;
  if (input.goalId != null) return goalWithPlace(db, input.goalId).project_id;
  if (input.sessionId != null) {
    const session = requireSession(db, input.sessionId);
    if (session.project_id !== null) return session.project_id;
  }
  throw new Error('Cannot tell which project this spend belongs to: pass a goal or a project');
}

export function reportSpend(db: DatabaseSync, input: SpendInput, now: Date = new Date()): SpendResult {
  if (!Number.isFinite(input.usd) || input.usd < 0) throw new Error('Spend must be a non-negative number of USD');
  return tx(db, () => {
    const projectId = spendProject(db, input);
    const goal = input.goalId != null ? requireGoal(db, input.goalId) : undefined;
    const goalBefore = goal === undefined ? 0 : spendForGoal(db, goal.id);
    const dayBefore = spendToday(db, projectId, now);
    const result = db
      .prepare('INSERT INTO spend (session_id, goal_id, project_id, usd, at) VALUES (?, ?, ?, ?, ?)')
      .run(input.sessionId ?? null, goal?.id ?? null, projectId, input.usd, iso(now));
    const deskId = frontDesk(db, now).id;
    const raisedBy = input.sessionId ?? null;
    const raised: Item[] = [];
    const goalAfter = goalBefore + input.usd;
    if (goal !== undefined && goal.budget_usd !== null && goalBefore <= goal.budget_usd && goalAfter > goal.budget_usd) {
      raised.push(
        raiseItem(
          db,
          {
            kind: 'blocked',
            goalId: goal.id,
            raisedBy,
            addressedTo: deskId,
            body: `Goal #${goal.id} is over budget: $${goalAfter.toFixed(2)} spent of $${goal.budget_usd.toFixed(2)}.`,
          },
          now,
        ),
      );
    }
    const project = requireProjectById(db, projectId);
    const dayAfter = dayBefore + input.usd;
    if (project.daily_budget_usd !== null && dayBefore <= project.daily_budget_usd && dayAfter > project.daily_budget_usd) {
      raised.push(
        raiseItem(
          db,
          {
            kind: 'info',
            goalId: goal?.id ?? null,
            raisedBy,
            addressedTo: deskId,
            body: `Project ${project.name} is over its daily budget: $${dayAfter.toFixed(2)} spent today (UTC) of $${project.daily_budget_usd.toFixed(2)}.`,
          },
          now,
        ),
      );
    }
    return {
      id: Number(result.lastInsertRowid),
      project_id: projectId,
      goal_total_usd: goal === undefined ? null : goalAfter,
      project_today_usd: dayAfter,
      raised,
    };
  });
}
```

**Step 4: run.** Expect PASS (`ℹ pass 3`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/spend.ts test/spend.test.ts
git commit -m "feat(roster): spend reporting with goal and daily budget items" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 3.8: Status summary <!-- deps: 3.6, 3.7, parallel: pg-6 -->

- **Type**: code
- **Spec**: R3 status ("per project: workstreams, architects and their staleness, active goals, open items, spend today"), R6 front desk ("show waiting items first"), AC3 ("status summary contents")
- **Acceptance**: `test/status.test.ts` passes. The summary has `waiting_for_user` first, then per project: workstreams with the running architect and its staleness, active goals with spend, unclosed items, and spend today.

**Files:** Create `src/roster/status.ts`, `test/status.test.ts`

**Step 1: failing test** `test/status.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGoal, updateGoal } from '../src/roster/goals.ts';
import { closeItem, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { checkIn, registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { reportSpend } from '../src/roster/spend.ts';
import { statusSummary } from '../src/roster/status.ts';
import { minutesBefore, tempRoster } from './helpers.ts';

test('status lists waiting items first, then each project in full', (t) => {
  const db = tempRoster(t);
  const now = new Date('2026-10-21T15:00:00.000Z');
  const desk = startFrontDesk(db, 'mm-front-desk', now);
  const alpha = addProject(db, { name: 'alpha', folder: 'C:\\a', dailyBudgetUsd: 20, workstreams: [{ name: 'ui', branch: 'feature/ui' }] });
  addProject(db, { name: 'beta', folder: 'C:\\b' });
  const main = requireWorkstream(db, alpha.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: alpha.id, workstreamId: main.id, name: 'mm-alpha-main' }, now);
  checkIn(db, arch.id, minutesBefore(now, 45));
  const active = createGoal(db, { workstreamId: main.id, text: 'Login page', budgetUsd: 10 });
  const finished = createGoal(db, { workstreamId: main.id, text: 'Old' });
  updateGoal(db, finished.id, { state: 'done' });
  reportSpend(db, { usd: 2.5, sessionId: arch.id, goalId: active.id }, minutesBefore(now, 10));
  const signoff = raiseItem(db, { kind: 'signoff', body: 'Plan + tests', goalId: active.id, raisedBy: arch.id }, minutesBefore(now, 5));
  const note = raiseItem(db, { kind: 'info', body: 'FYI', raisedBy: arch.id });
  closeItem(db, note.id);

  const status = statusSummary(db, now);
  assert.equal(status.generated_at, now.toISOString());
  assert.deepEqual(status.waiting_for_user.map((i) => [i.id, i.kind, i.raised_by]), [[signoff.id, 'signoff', 'mm-alpha-main']]);
  assert.deepEqual(status.projects.map((p) => p.name), ['alpha', 'beta']);
  const a = status.projects[0];
  assert.equal(a.spend_today_usd, 2.5);
  assert.equal(a.daily_budget_usd, 20);
  assert.deepEqual(a.workstreams.map((w) => [w.name, w.branch, w.architect?.name ?? null]), [['main', 'main', 'mm-alpha-main'], ['ui', 'feature/ui', null]]);
  assert.equal(a.workstreams[0].architect?.minutes_since_checkin, 45);
  assert.equal(a.workstreams[0].architect?.stale, true);
  assert.deepEqual(a.active_goals.map((g) => [g.id, g.state, g.spent_usd, g.workstream]), [[active.id, 'new', 2.5, 'main']]);
  assert.deepEqual(a.open_items.map((i) => i.id), [signoff.id]);
  assert.equal(a.open_items[0].seen, false);
  assert.deepEqual(status.projects[1].active_goals, []);
});

test('a recently checked-in architect is not stale', (t) => {
  const db = tempRoster(t);
  const now = new Date('2026-10-21T15:00:00.000Z');
  const p = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, p.id, 'main');
  const arch = registerSession(db, { role: 'architect', projectId: p.id, workstreamId: main.id, name: 'mm-alpha-main' });
  checkIn(db, arch.id, minutesBefore(now, 5));
  assert.equal(statusSummary(db, now).projects[0].workstreams[0].architect?.stale, false);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/roster/status.ts`:

```ts
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { iso, many } from './db.ts';
import { activeGoals } from './goals.ts';
import type { ItemKind, ItemState } from './items.ts';
import { listProjects, listWorkstreams, type Project } from './projects.ts';
import { frontDesk, runningArchitect, type Session } from './sessions.ts';
import { spendForGoal, spendToday } from './spend.ts';

export const STALE_AFTER_MINUTES = 30;

export interface ArchitectStatus {
  session_id: number;
  name: string | null;
  pid: number | null;
  last_checkin_at: string | null;
  minutes_since_checkin: number | null;
  stale: boolean;
}

export interface WorkstreamStatus {
  name: string;
  branch: string;
  architect: ArchitectStatus | null;
}

export interface GoalStatus {
  id: number;
  workstream: string;
  text: string;
  state: string;
  budget_usd: number | null;
  spent_usd: number;
}

export interface ItemStatus {
  id: number;
  kind: ItemKind;
  state: ItemState;
  body: string;
  answer: string | null;
  goal_id: number | null;
  raised_by: string | null;
  addressed_to: string | null;
  seen: boolean;
  created_at: string;
}

export interface ProjectStatus {
  name: string;
  folder: string;
  permission_mode: string;
  idle_stop_minutes: number;
  daily_budget_usd: number | null;
  spend_today_usd: number;
  workstreams: WorkstreamStatus[];
  active_goals: GoalStatus[];
  open_items: ItemStatus[];
}

export interface StatusSummary {
  generated_at: string;
  stale_after_minutes: number;
  waiting_for_user: ItemStatus[];
  projects: ProjectStatus[];
}

const ITEM_SELECT = `SELECT i.id, i.kind, i.state, i.body, i.answer, i.goal_id, i.seen, i.created_at,
    r.name AS raised_by, a.name AS addressed_to
  FROM items i
  LEFT JOIN goals g ON g.id = i.goal_id
  LEFT JOIN workstreams w ON w.id = g.workstream_id
  LEFT JOIN sessions r ON r.id = i.raised_by
  LEFT JOIN sessions a ON a.id = i.addressed_to`;

function itemRows(db: DatabaseSync, where: string, params: SQLInputValue[]): ItemStatus[] {
  const rows = many<Omit<ItemStatus, 'seen'> & { seen: number }>(
    db.prepare(`${ITEM_SELECT} ${where} ORDER BY i.created_at, i.id`).all(...params),
  );
  return rows.map((row) => ({ ...row, seen: row.seen === 1 }));
}

function architectStatus(session: Session | undefined, now: Date, staleAfter: number): ArchitectStatus | null {
  if (session === undefined) return null;
  const minutes =
    session.last_checkin_at === null ? null : Math.floor((now.getTime() - Date.parse(session.last_checkin_at)) / 60_000);
  return {
    session_id: session.id,
    name: session.name,
    pid: session.pid,
    last_checkin_at: session.last_checkin_at,
    minutes_since_checkin: minutes,
    stale: minutes === null || minutes > staleAfter,
  };
}

function projectStatus(db: DatabaseSync, project: Project, now: Date, staleAfter: number): ProjectStatus {
  return {
    name: project.name,
    folder: project.folder,
    permission_mode: project.permission_mode,
    idle_stop_minutes: project.idle_stop_minutes,
    daily_budget_usd: project.daily_budget_usd,
    spend_today_usd: spendToday(db, project.id, now),
    workstreams: listWorkstreams(db, project.name).map((w) => ({
      name: w.name,
      branch: w.branch,
      architect: architectStatus(runningArchitect(db, w.id), now, staleAfter),
    })),
    active_goals: activeGoals(db, project.id).map((g) => ({
      id: g.id,
      workstream: g.workstream,
      text: g.text,
      state: g.state,
      budget_usd: g.budget_usd,
      spent_usd: spendForGoal(db, g.id),
    })),
    open_items: itemRows(db, "WHERE i.state <> 'closed' AND (w.project_id = ? OR (i.goal_id IS NULL AND r.project_id = ?))", [
      project.id,
      project.id,
    ]),
  };
}

export function statusSummary(db: DatabaseSync, now: Date = new Date(), staleAfterMinutes: number = STALE_AFTER_MINUTES): StatusSummary {
  const desk = frontDesk(db, now);
  return {
    generated_at: iso(now),
    stale_after_minutes: staleAfterMinutes,
    waiting_for_user: itemRows(db, "WHERE i.addressed_to = ? AND i.state = 'open'", [desk.id]),
    projects: listProjects(db).map((project) => projectStatus(db, project, now, staleAfterMinutes)),
  };
}
```

**Step 4: run.** Expect PASS (`ℹ pass 2`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/status.ts test/status.test.ts
git commit -m "feat(roster): status summary with waiting items first" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: Launching and stopping sessions (R4, AC4)

Use the same red-green cycle as Phase 3. Before starting, read `spike.md` "Notes for implementation". If the spike recorded different quoting, field names or timing, apply that in 4.1, 4.2 or 4.4 and mention it in the commit message.

### [ ] Task 4.1: Launch command builder (pure) <!-- deps: 2.1, parallel: pg-1 -->

- **Type**: code
- **Spec**: R4 Launch (exact `wt.exe … claude …` command, `--settings` env, skip-permissions omitted by project), R4 Stop (`taskkill /PID <pid> /T /F`), AC4
- **Acceptance**: `test/command.test.ts` passes. It checks the exact argument list with and without `--dangerously-skip-permissions`, the env in the settings file (`MM_ROLE`, `MM_SESSION_ID`, `MM_PARENT_ID`, `MM_ROSTER_DB`, `MM_VOICE=off`), developer worktrees, escaping of `;`, session names and the stop command. Nothing is launched.

**Deliberate deviation from the spec text.** `--settings` gets the **path** of a JSON file, not inline JSON. `claude --help` documents `--settings <file-or-json>`. Inline JSON would have to pass through Node's argument quoting, then `wt.exe`'s command-line rebuild, then Claude's parser, and `wt.exe` splits on `;`. The file carries exactly the JSON the spec describes. `--plugin-dir <plugin root>` is also added, so the tab session loads the roster MCP server and hooks while the plugin is loaded with `--plugin-dir`. Both are recorded as assumptions.

**Files:** Create `src/launch/command.ts`, `test/command.test.ts`

**Step 1: failing test** `test/command.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  architectPrompt,
  buildLaunchCommand,
  buildStopCommand,
  developerPrompt,
  escapeForWt,
  sessionName,
  type LaunchSpec,
} from '../src/launch/command.ts';

const base: LaunchSpec = {
  wtPath: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
  name: 'mm-alpha-main',
  folder: 'C:\\work\\alpha project',
  role: 'architect',
  skipPermissions: true,
  briefingFile: 'I:\\Dropbox (Personal)\\mm\\briefings\\architect.md',
  pluginDir: 'I:\\Dropbox (Personal)\\mm',
  settingsPath: 'C:\\Users\\me\\.claude\\multi-manager\\sessions\\7.settings.json',
  prompt: 'You are the architect. Start with goal #3.',
  sessionId: 7,
  parentId: 1,
  rosterDb: 'C:\\Users\\me\\.claude\\multi-manager\\roster.db',
};

test('architect launch: exact wt.exe arguments with skipped permissions', () => {
  const command = buildLaunchCommand(base);
  assert.equal(command.file, base.wtPath);
  assert.deepEqual(command.args, [
    '-w', 'multi-manager', 'new-tab', '--profile', 'Multi-Manager', '--title', 'mm-alpha-main', '-d', 'C:\\work\\alpha project',
    'claude', '-n', 'mm-alpha-main', '--dangerously-skip-permissions',
    '--plugin-dir', 'I:\\Dropbox (Personal)\\mm',
    '--append-system-prompt-file', 'I:\\Dropbox (Personal)\\mm\\briefings\\architect.md',
    '--settings', 'C:\\Users\\me\\.claude\\multi-manager\\sessions\\7.settings.json',
    'You are the architect. Start with goal #3.',
  ]);
});

test('architect launch without skipped permissions omits only that flag', () => {
  const skipped = buildLaunchCommand(base).args;
  const prompted = buildLaunchCommand({ ...base, skipPermissions: false }).args;
  assert.ok(!prompted.includes('--dangerously-skip-permissions'));
  assert.deepEqual(prompted, skipped.filter((arg) => arg !== '--dangerously-skip-permissions'));
});

test('the session env goes into the --settings file', () => {
  const command = buildLaunchCommand(base);
  assert.equal(command.settings.path, base.settingsPath);
  assert.deepEqual(JSON.parse(command.settings.content), {
    env: { MM_ROLE: 'architect', MM_SESSION_ID: '7', MM_PARENT_ID: '1', MM_ROSTER_DB: base.rosterDb, MM_VOICE: 'off' },
  });
});

test('no parent means no MM_PARENT_ID', () => {
  const env = JSON.parse(buildLaunchCommand({ ...base, parentId: null }).settings.content).env;
  assert.equal(env.MM_PARENT_ID, undefined);
});

test('developer sessions get the developer role and their own worktree', () => {
  const command = buildLaunchCommand({ ...base, role: 'developer', name: 'mm-alpha-main-dev-login', worktree: 'mm-alpha-main-dev-login' });
  const at = command.args.indexOf('--worktree');
  assert.ok(at > command.args.indexOf('claude'));
  assert.equal(command.args[at + 1], 'mm-alpha-main-dev-login');
  assert.equal(JSON.parse(command.settings.content).env.MM_ROLE, 'developer');
});

test('semicolons are escaped so wt.exe does not split the command', () => {
  assert.equal(escapeForWt('a; b;c'), 'a\\; b\\;c');
  const command = buildLaunchCommand({ ...base, prompt: 'Plan it; then build', folder: 'C:\\odd;folder' });
  assert.equal(command.args.at(-1), 'Plan it\\; then build');
  assert.equal(command.args[command.args.indexOf('-d') + 1], 'C:\\odd\\;folder');
});

test('session names are lower-case slugs', () => {
  assert.equal(sessionName('My App', 'main'), 'mm-my-app-main');
  assert.equal(sessionName('alpha', 'main', 'dev', 'Login Form!'), 'mm-alpha-main-dev-login-form');
});

test('stop kills the whole process tree', () => {
  assert.deepEqual(buildStopCommand(4242), { file: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
  assert.throws(() => buildStopCommand(0), /Invalid process id/);
});

test('initial prompts name the roster goal or session and contain no semicolons', () => {
  assert.match(architectPrompt('alpha', 'main', 3), /roster goal #3/);
  assert.match(architectPrompt('alpha', 'main'), /No goal yet/);
  assert.match(developerPrompt('alpha', 'main', 'Build the login form', 12), /roster session #12/);
  for (const prompt of [architectPrompt('a', 'b', 1), architectPrompt('a', 'b'), developerPrompt('a', 'b', 'x', 1)]) {
    assert.ok(!prompt.includes(';'));
  }
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/launch/command.ts`:

```ts
export interface Command {
  file: string;
  args: string[];
}

export interface SettingsFile {
  path: string;
  content: string;
}

export interface LaunchCommand extends Command {
  settings: SettingsFile;
}

export interface LaunchSpec {
  wtPath: string;
  name: string;
  folder: string;
  role: 'architect' | 'developer';
  skipPermissions: boolean;
  briefingFile: string;
  pluginDir: string;
  settingsPath: string;
  prompt: string;
  sessionId: number;
  parentId: number | null;
  rosterDb: string;
  worktree?: string;
}

export const WT_WINDOW = 'multi-manager';
export const WT_PROFILE = 'Multi-Manager';

function slug(text: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'x' : cleaned;
}

/** mm-<project>-<workstream>[-…]: used for -n, the tab title and the session-file lookup. */
export function sessionName(...parts: string[]): string {
  return ['mm', ...parts.map(slug)].join('-');
}

/** wt.exe treats an unescaped ';' as a sub-command separator. */
export function escapeForWt(arg: string): string {
  return arg.replace(/;/g, '\\;');
}

export function sessionEnv(spec: LaunchSpec): Record<string, string> {
  const env: Record<string, string> = {
    MM_ROLE: spec.role,
    MM_SESSION_ID: String(spec.sessionId),
    MM_ROSTER_DB: spec.rosterDb,
    MM_VOICE: 'off',
  };
  if (spec.parentId !== null) env.MM_PARENT_ID = String(spec.parentId);
  return env;
}

export function buildLaunchCommand(spec: LaunchSpec): LaunchCommand {
  const claude = ['claude', '-n', spec.name];
  if (spec.skipPermissions) claude.push('--dangerously-skip-permissions');
  if (spec.worktree !== undefined) claude.push('--worktree', spec.worktree);
  claude.push(
    '--plugin-dir', spec.pluginDir,
    '--append-system-prompt-file', spec.briefingFile,
    '--settings', spec.settingsPath,
    spec.prompt,
  );
  const args = ['-w', WT_WINDOW, 'new-tab', '--profile', WT_PROFILE, '--title', spec.name, '-d', spec.folder, ...claude];
  return {
    file: spec.wtPath,
    args: args.map(escapeForWt),
    settings: { path: spec.settingsPath, content: `${JSON.stringify({ env: sessionEnv(spec) }, null, 2)}\n` },
  };
}

export function buildStopCommand(pid: number): Command {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid process id ${pid}`);
  return { file: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
}

export function architectPrompt(project: string, workstream: string, goalId?: number): string {
  const start = `You are the Multi-Manager architect for project ${project}, workstream ${workstream}.`;
  if (goalId === undefined) {
    return `${start} No goal yet. Call the roster tool list_items for anything addressed to you, then wait for the front desk.`;
  }
  return `${start} Your goal is roster goal #${goalId}. Call the roster tool get_goal with goal_id ${goalId} and follow your briefing.`;
}

export function developerPrompt(project: string, workstream: string, task: string, sessionId: number): string {
  return `You are a Multi-Manager developer (roster session #${sessionId}) for project ${project}, workstream ${workstream}. Your task: ${task.replace(/;/g, ',')}`;
}
```

**Step 4: run.** Expect PASS (`ℹ pass 9`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/launch/command.ts test/command.test.ts
git commit -m "feat(launch): pure wt.exe launch and taskkill stop command builder" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 4.2: Claude session-file pid lookup <!-- deps: 2.1, parallel: pg-1 -->

- **Type**: code
- **Spec**: R0 step 8, R2 Sessions (process id), R4 ("Store the session's process id once found (method from the spike)")
- **Acceptance**: `test/process.test.ts` passes. It finds the newest `~/.claude/sessions/<pid>.json` whose `name` matches, ignores files older than `since`, other names and broken files, returns null when the folder is missing, and parses `tasklist` CSV output.

**ADJUST to spike.md step 8:** the code matches on the `name` field and orders by `startedAt`, which is what this machine's session files showed on 2026-10-21 (`{"pid":3260,"sessionId":"…","name":"multi-manager-ac","nameSource":"derived","startedAt":1792586145654,…}`). If the spike recorded a different field, change `findSessionPid` and its test fixtures to use it.

**Files:** Create `src/launch/process.ts`, `test/process.test.ts`

**Step 1: failing test** `test/process.test.ts`:

```ts
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findSessionPid, parseTasklistImage, readSessionFile } from '../src/launch/process.ts';
import { tempDir } from './helpers.ts';

function writeSession(dir: string, pid: number, fields: Record<string, unknown>): void {
  writeFileSync(join(dir, `${pid}.json`), JSON.stringify({ pid, kind: 'interactive', ...fields }));
}

test('finds the newest session file with the given name', (t) => {
  const dir = tempDir(t);
  writeSession(dir, 100, { name: 'mm-alpha-main', startedAt: 1000 });
  writeSession(dir, 200, { name: 'mm-alpha-main', startedAt: 3000 });
  writeSession(dir, 300, { name: 'mm-beta-main', startedAt: 4000 });
  writeFileSync(join(dir, '400.json'), '{not json');
  writeFileSync(join(dir, '200.7b76.key'), 'x');
  assert.equal(findSessionPid('mm-alpha-main', { dir }), 200);
  assert.equal(findSessionPid('mm-alpha-main', { dir, since: 3500 }), null);
  assert.equal(findSessionPid('mm-gamma-main', { dir }), null);
});

test('a missing sessions folder means no pid', (t) => {
  assert.equal(findSessionPid('mm-alpha-main', { dir: join(tempDir(t), 'missing') }), null);
});

test('readSessionFile reads <pid>.json or returns null', (t) => {
  const dir = tempDir(t);
  writeSession(dir, 77, { name: 'mm-alpha-main', startedAt: 1 });
  assert.equal(readSessionFile(77, dir)?.name, 'mm-alpha-main');
  assert.equal(readSessionFile(78, dir), null);
});

test('parseTasklistImage reads the image name from tasklist CSV', () => {
  assert.equal(parseTasklistImage('"claude.exe","4242","Console","1","301,512 K"\r\n'), 'claude.exe');
  assert.equal(parseTasklistImage('INFO: No tasks are running which match the specified criteria.\r\n'), null);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/launch/process.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The fields we rely on in Claude Code's ~/.claude/sessions/<pid>.json (verified 2026-10-21; see spike.md). */
export interface ClaudeSessionFile {
  pid: number;
  name?: string;
  startedAt?: number;
  kind?: string;
  cwd?: string;
}

export function claudeSessionsDir(): string {
  return join(homedir(), '.claude', 'sessions');
}

export function readSessionFile(pid: number, dir: string = claudeSessionsDir()): ClaudeSessionFile | null {
  try {
    return JSON.parse(readFileSync(join(dir, `${pid}.json`), 'utf8')) as ClaudeSessionFile;
  } catch {
    return null;
  }
}

export function findSessionPid(name: string, options: { since?: number; dir?: string } = {}): number | null {
  const dir = options.dir ?? claudeSessionsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let best: ClaudeSessionFile | null = null;
  for (const entry of entries) {
    if (!/^\d+\.json$/.test(entry)) continue;
    let file: ClaudeSessionFile;
    try {
      file = JSON.parse(readFileSync(join(dir, entry), 'utf8')) as ClaudeSessionFile;
    } catch {
      continue;
    }
    if (file.name !== name || typeof file.pid !== 'number') continue;
    const started = file.startedAt ?? 0;
    if (options.since !== undefined && started < options.since) continue;
    if (best === null || started > (best.startedAt ?? 0)) best = file;
  }
  return best === null ? null : best.pid;
}

/** `tasklist /FI "PID eq N" /FO CSV /NH` → "claude.exe","N",… or an INFO line when nothing matches. */
export function parseTasklistImage(csv: string): string | null {
  const match = /^"([^"]+)","(\d+)"/m.exec(csv.trim());
  return match === null ? null : match[1];
}
```

**Step 4: run.** Expect PASS (`ℹ pass 4`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/launch/process.ts test/process.test.ts
git commit -m "feat(launch): find a tab session's pid from Claude session files" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 4.3: Windows Terminal profile fragment <!-- deps: 2.1, parallel: pg-1 -->

- **Type**: code
- **Spec**: R0 step 1, R4 Stop ("the tab closes because the Multi-Manager profile has `closeOnExit: always`")
- **Acceptance**: `test/terminal-profile.test.ts` passes. The fragment is written to `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\multi-manager\multi-manager.json` with the same content as the spike's fragment, and the call is idempotent. `node scripts/install-terminal-profile.ts` prints the path.

**Files:** Create `src/launch/terminal-profile.ts`, `scripts/install-terminal-profile.ts`, `test/terminal-profile.test.ts`

**Step 1: failing test** `test/terminal-profile.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureTerminalProfile, fragmentPath } from '../src/launch/terminal-profile.ts';
import { tempDir } from './helpers.ts';

test('the fragment lives under LOCALAPPDATA', () => {
  assert.equal(
    fragmentPath({ LOCALAPPDATA: 'C:\\L' }),
    join('C:\\L', 'Microsoft', 'Windows Terminal', 'Fragments', 'multi-manager', 'multi-manager.json'),
  );
});

test('ensureTerminalProfile writes a closeOnExit:always profile once', (t) => {
  const env = { LOCALAPPDATA: tempDir(t) };
  const first = ensureTerminalProfile(env);
  assert.equal(first.written, true);
  const fragment = JSON.parse(readFileSync(first.path, 'utf8'));
  assert.deepEqual(fragment, {
    profiles: [{ name: 'Multi-Manager', commandline: 'cmd.exe', closeOnExit: 'always', suppressApplicationTitle: true }],
  });
  assert.equal(ensureTerminalProfile(env).written, false);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/launch/terminal-profile.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Env } from '../roster/db.ts';

/** Same content as conductor/tracks/core_20261021/spike/multi-manager.json. */
export const FRAGMENT = {
  profiles: [{ name: 'Multi-Manager', commandline: 'cmd.exe', closeOnExit: 'always', suppressApplicationTitle: true }],
};

export function fragmentPath(env: Env = process.env): string {
  const base = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return join(base, 'Microsoft', 'Windows Terminal', 'Fragments', 'multi-manager', 'multi-manager.json');
}

export function ensureTerminalProfile(env: Env = process.env): { path: string; written: boolean } {
  const path = fragmentPath(env);
  const content = `${JSON.stringify(FRAGMENT, null, 2)}\n`;
  try {
    if (readFileSync(path, 'utf8') === content) return { path, written: false };
  } catch {
    // not installed yet
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { path, written: true };
}
```

`scripts/install-terminal-profile.ts`:

```ts
import { ensureTerminalProfile } from '../src/launch/terminal-profile.ts';

const result = ensureTerminalProfile();
console.log(`${result.written ? 'Installed' : 'Already installed'}: ${result.path}`);
if (result.written) console.log('Restart Windows Terminal so it picks up the Multi-Manager profile.');
```

**Step 4: run.** `node --test test/terminal-profile.test.ts` should PASS (`ℹ pass 2`). Then run `node scripts/install-terminal-profile.ts`. Expected: `Already installed: %LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\multi-manager\multi-manager.json`, because the spike installed the same content. If it prints `Installed`, the spike's file differed. Diff the two and reconcile them. Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/launch/terminal-profile.ts scripts/install-terminal-profile.ts test/terminal-profile.test.ts
git commit -m "feat(launch): install the Multi-Manager Windows Terminal profile" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 4.4: Runner <!-- deps: 4.1, 4.2, 4.3, parallel: pg-2 -->

- **Type**: code
- **Spec**: Technical notes ("one small module … that runs it"), R4 (store pid, kill tree)
- **Acceptance**: `test/runner.test.ts` passes. `runCommand` returns the exit code, stdout and stderr and never throws. `waitForPid` polls until the session file appears, or gives up. `ownsProcess` refuses unless both the session file name and the `tasklist` image (`claude.exe`) match. This guard means the stop path never kills a process Multi-Manager did not start.

**Files:** Create `src/launch/runner.ts`, `test/runner.test.ts`

**Step 1: failing test** `test/runner.test.ts`:

```ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ownsProcess, runCommand, waitForPid, writeSettingsFile } from '../src/launch/runner.ts';
import { tempDir } from './helpers.ts';

test('runCommand returns exit code and output', async () => {
  const result = await runCommand({
    file: process.execPath,
    args: ['-e', 'process.stdout.write("hi"); process.stderr.write("oops"); process.exit(3)'],
  });
  assert.deepEqual(result, { code: 3, stdout: 'hi', stderr: 'oops' });
});

test('runCommand reports a missing program instead of throwing', async () => {
  const result = await runCommand({ file: 'mm-no-such-program-xyz', args: [] });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /ENOENT/);
});

test('waitForPid polls until the session file appears', async (t) => {
  const dir = tempDir(t);
  setTimeout(() => writeFileSync(join(dir, '77.json'), JSON.stringify({ pid: 77, name: 'mm-a-main', startedAt: Date.now() })), 150);
  assert.equal(await waitForPid('mm-a-main', Date.now() - 1000, { dir, timeoutMs: 3000, intervalMs: 50 }), 77);
});

test('waitForPid gives up after the timeout', async (t) => {
  assert.equal(await waitForPid('nobody', 0, { dir: tempDir(t), timeoutMs: 200, intervalMs: 50 }), null);
});

test('writeSettingsFile creates its folder', (t) => {
  const path = join(tempDir(t), 'sessions', '7.settings.json');
  writeSettingsFile({ path, content: '{"env":{}}\n' });
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), '{"env":{}}\n');
});

test('ownsProcess refuses a name mismatch and a non-claude image', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'mm-a-main' }));
  assert.equal(await ownsProcess(process.pid, 'mm-other', dir), false);
  assert.equal(await ownsProcess(process.pid, 'mm-a-main', dir), false); // image is node.exe, not claude.exe
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/launch/runner.ts`:

```ts
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Command, SettingsFile } from './command.ts';
import { claudeSessionsDir, findSessionPid, parseTasklistImage, readSessionFile } from './process.ts';
import { ensureTerminalProfile } from './terminal-profile.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (command: Command) => Promise<RunResult>;

/** Everything the launcher does to the outside world; tests pass fakes. */
export interface LaunchDeps {
  run: Runner;
  writeSettings: (file: SettingsFile) => void;
  waitForPid: (name: string, since: number) => Promise<number | null>;
  findPid: (name: string) => number | null;
  ownsProcess: (pid: number, name: string) => Promise<boolean>;
  ensureTerminalProfile: () => void;
}

export const runCommand: Runner = (command) =>
  new Promise((resolve) => {
    execFile(command.file, command.args, { timeout: 60_000, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stdout, stderr: stderr !== '' ? stderr : (error?.message ?? '') });
    });
  });

export function writeSettingsFile(file: SettingsFile): void {
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, file.content);
}

export interface WaitOptions {
  dir?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForPid(name: string, since: number, options: WaitOptions = {}): Promise<number | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const pid = findSessionPid(name, { since, dir: options.dir });
    if (pid !== null) return pid;
    if (Date.now() >= deadline) return null;
    await delay(options.intervalMs ?? 500);
  }
}

/** True only if <pid>.json names this session and the live process is claude.exe. Guards against pid reuse. */
export async function ownsProcess(pid: number, name: string, dir: string = claudeSessionsDir()): Promise<boolean> {
  if (readSessionFile(pid, dir)?.name !== name) return false;
  const result = await runCommand({ file: 'tasklist', args: ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'] });
  return parseTasklistImage(result.stdout)?.toLowerCase() === 'claude.exe';
}

export function realDeps(): LaunchDeps {
  return {
    run: runCommand,
    writeSettings: writeSettingsFile,
    waitForPid: (name, since) => waitForPid(name, since),
    findPid: (name) => findSessionPid(name),
    ownsProcess: (pid, name) => ownsProcess(pid, name),
    ensureTerminalProfile: () => {
      ensureTerminalProfile();
    },
  };
}
```

**Step 4: run.** Expect PASS (`ℹ pass 6`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/launch/runner.ts test/runner.test.ts
git commit -m "feat(launch): runner with pid polling and ownership check" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 4.5: Launcher (launch and stop architects and developers) <!-- deps: 3.4, 3.6, 4.4, parallel: pg-5 -->

- **Type**: code
- **Spec**: R4 (launch if none running, else return existing; store pid; stop = kill tree + mark stopped; permission-mode warning; full-session developers launched the same way), R2 Claims (released on stop)
- **Acceptance**: `test/launcher.test.ts` passes using fake deps only. It covers the exact launch, the goal moving to `planning`, a second launch returning the existing session, a failed launch marked stopped and retryable, the permission warning, a missing pid, a stop that kills and releases claims, a stop that refuses to kill a process it does not own, and a developer launch and stop cascade.

**Files:** Create `src/launch/launcher.ts`, `test/launcher.test.ts`

**Step 1: failing test** `test/launcher.test.ts`:

```ts
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Command, SettingsFile } from '../src/launch/command.ts';
import { launchArchitect, launchDeveloper, stopArchitect, type LaunchContext } from '../src/launch/launcher.ts';
import type { LaunchDeps } from '../src/launch/runner.ts';
import { claim, listClaims } from '../src/roster/claims.ts';
import { createGoal, requireGoal } from '../src/roster/goals.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { requireSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempRoster } from './helpers.ts';

function fakeDeps(overrides: Partial<LaunchDeps> = {}) {
  const calls = { run: [] as Command[], settings: [] as SettingsFile[], profile: 0 };
  const deps: LaunchDeps = {
    run: async (command) => {
      calls.run.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
    writeSettings: (file) => {
      calls.settings.push(file);
    },
    waitForPid: async (name) => (name.includes('-dev-') ? 5151 : 4242),
    findPid: () => null,
    ownsProcess: async () => true,
    ensureTerminalProfile: () => {
      calls.profile += 1;
    },
    ...overrides,
  };
  return { deps, calls };
}

function setup(t: TestContext, deps: LaunchDeps, permissionMode?: string) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\work\\alpha', permissionMode });
  const main = requireWorkstream(db, project.id, 'main');
  const ctx: LaunchContext = { db, deps, pluginRoot: 'I:\\mm', env: { MM_ROSTER_DB: process.env.MM_ROSTER_DB, LOCALAPPDATA: 'C:\\L' } };
  return { db, desk, project, main, ctx };
}

test('launching an architect opens a tab, stores the pid and moves the goal to planning', async (t) => {
  const { deps, calls } = fakeDeps();
  const { db, desk, main, ctx } = setup(t, deps);
  const goal = createGoal(db, { workstreamId: main.id, text: 'Login page' });
  const result = await launchArchitect(ctx, { project: 'alpha', goalId: goal.id, parentId: desk.id });
  assert.equal(result.existing, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.session.name, 'mm-alpha-main');
  assert.equal(result.session.pid, 4242);
  assert.equal(result.session.parent_id, desk.id);
  assert.equal(calls.profile, 1);
  const command = calls.run[0];
  assert.equal(command.file, join('C:\\L', 'Microsoft', 'WindowsApps', 'wt.exe'));
  assert.equal(command.args[command.args.indexOf('-d') + 1], 'C:\\work\\alpha');
  assert.ok(command.args.includes('--dangerously-skip-permissions'));
  assert.equal(command.args[command.args.indexOf('--append-system-prompt-file') + 1], join('I:\\mm', 'briefings', 'architect.md'));
  assert.match(command.args.at(-1) ?? '', new RegExp(`roster goal #${goal.id}`));
  const rosterDb = process.env.MM_ROSTER_DB ?? '';
  assert.equal(calls.settings[0].path, join(dirname(rosterDb), 'sessions', `${result.session.id}.settings.json`));
  assert.deepEqual(JSON.parse(calls.settings[0].content).env, {
    MM_ROLE: 'architect',
    MM_SESSION_ID: String(result.session.id),
    MM_PARENT_ID: String(desk.id),
    MM_ROSTER_DB: rosterDb,
    MM_VOICE: 'off',
  });
  assert.equal(requireGoal(db, goal.id).state, 'planning');
});

test('a running architect is returned instead of launching another', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const first = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const second = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(second.existing, true);
  assert.equal(second.session.id, first.session.id);
  assert.equal(calls.run.length, 1);
});

test('a failed launch is marked stopped and can be retried', async (t) => {
  let fail = true;
  const { deps } = fakeDeps({ run: async () => (fail ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' }) });
  const { db, desk, ctx } = setup(t, deps);
  await assert.rejects(launchArchitect(ctx, { project: 'alpha', parentId: desk.id }), /Windows Terminal launch failed \(exit 1\): boom/);
  const failed = requireSession(db, 2);
  assert.equal(failed.state, 'stopped');
  fail = false;
  assert.equal((await launchArchitect(ctx, { project: 'alpha', parentId: desk.id })).existing, false);
});

test('a project with another permission mode launches without the flag and warns', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps, 'default');
  const result = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.ok(!calls.run[0].args.includes('--dangerously-skip-permissions'));
  assert.match(result.warnings[0], /held for your approval/);
});

test('a missing pid is a warning, not a failure', async (t) => {
  const { deps } = fakeDeps({ waitForPid: async () => null });
  const { desk, ctx } = setup(t, deps);
  const result = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  assert.equal(result.session.pid, null);
  assert.match(result.warnings[0], /process id was not found/);
});

test('a goal from another workstream is refused', async (t) => {
  const { deps } = fakeDeps();
  const { db, desk, project, ctx } = setup(t, deps);
  db.prepare("INSERT INTO workstreams (project_id, name, branch) VALUES (?, 'ui', 'feature/ui')").run(project.id);
  const goal = createGoal(db, { workstreamId: requireWorkstream(db, project.id, 'ui').id, text: 'x' });
  await assert.rejects(launchArchitect(ctx, { project: 'alpha', goalId: goal.id, parentId: desk.id }), /does not belong to alpha\/main/);
});

test('stopping kills the process tree, marks stopped and releases claims', async (t) => {
  const { deps, calls } = fakeDeps();
  const { db, desk, project, ctx } = setup(t, deps);
  const { session } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  claim(db, project.id, 'package.json', session.id);
  const stopped = await stopArchitect(ctx, { project: 'alpha' });
  assert.equal(stopped.killed, true);
  assert.deepEqual(calls.run[1], { file: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
  assert.equal(stopped.session.state, 'stopped');
  assert.deepEqual(listClaims(db, project.id), []);
  await assert.rejects(stopArchitect(ctx, { project: 'alpha' }), /No running architect for alpha\/main/);
});

test('stop never kills a process it does not own', async (t) => {
  const { deps, calls } = fakeDeps({ ownsProcess: async () => false });
  const { desk, ctx } = setup(t, deps);
  await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const stopped = await stopArchitect(ctx, { project: 'alpha' });
  assert.equal(stopped.killed, false);
  assert.equal(calls.run.length, 1);
  assert.match(stopped.warnings.join('\n'), /nothing was killed/);
  assert.equal(stopped.session.state, 'stopped');
});

test('architects launch developer tabs in their own worktree; stopping the architect stops them first', async (t) => {
  const { deps, calls } = fakeDeps();
  const { desk, ctx } = setup(t, deps);
  const { session: architect } = await launchArchitect(ctx, { project: 'alpha', parentId: desk.id });
  const dev = await launchDeveloper(ctx, { architectId: architect.id, task: 'Build the login form', label: 'login' });
  assert.equal(dev.session.role, 'developer');
  assert.equal(dev.session.parent_id, architect.id);
  assert.equal(dev.session.name, 'mm-alpha-main-dev-login');
  const devArgs = calls.run[1].args;
  assert.equal(devArgs[devArgs.indexOf('--worktree') + 1], 'mm-alpha-main-dev-login');
  assert.equal(devArgs[devArgs.indexOf('--append-system-prompt-file') + 1], join('I:\\mm', 'briefings', 'developer.md'));
  await stopArchitect(ctx, { project: 'alpha' });
  assert.deepEqual(calls.run.slice(2).map((c) => c.args[1]), ['5151', '4242']);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement** `src/launch/launcher.ts`:

```ts
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { releaseAll } from '../roster/claims.ts';
import { resolveDbPath, type Env } from '../roster/db.ts';
import { requireGoal, updateGoal } from '../roster/goals.ts';
import {
  DEFAULT_PERMISSION_MODE,
  requireProject,
  requireProjectById,
  requireWorkstream,
  requireWorkstreamById,
  type Project,
  type Workstream,
} from '../roster/projects.ts';
import {
  registerSession,
  requireSession,
  runningArchitect,
  runningChildren,
  setSessionPid,
  setSessionState,
  type Session,
} from '../roster/sessions.ts';
import { architectPrompt, buildLaunchCommand, buildStopCommand, developerPrompt, sessionName } from './command.ts';
import type { LaunchDeps } from './runner.ts';

export interface LaunchContext {
  db: DatabaseSync;
  deps: LaunchDeps;
  pluginRoot: string;
  env: Env;
}

export interface LaunchResult {
  session: Session;
  existing: boolean;
  warnings: string[];
}

export interface StopResult {
  session: Session;
  killed: boolean;
  warnings: string[];
}

interface TabSpec {
  role: 'architect' | 'developer';
  project: Project;
  workstream: Workstream;
  name: string;
  parentId: number | null;
  prompt: (sessionId: number) => string;
  worktree?: string;
}

export function wtPath(env: Env): string {
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe') : 'wt.exe';
}

export function permissionWarning(project: Project): string | null {
  if (project.permission_mode === DEFAULT_PERMISSION_MODE) return null;
  return (
    `Project ${project.name} uses permission mode "${project.permission_mode}" instead of ${DEFAULT_PERMISSION_MODE}. ` +
    'Claude Code holds cross-session messages between sessions in different permission modes, ' +
    'so messages to and from its sessions will be held for your approval.'
  );
}

async function launchTab(ctx: LaunchContext, tab: TabSpec): Promise<LaunchResult> {
  const warnings: string[] = [];
  const warning = permissionWarning(tab.project);
  if (warning !== null) warnings.push(warning);
  ctx.deps.ensureTerminalProfile();
  const session = registerSession(ctx.db, {
    role: tab.role,
    parentId: tab.parentId,
    projectId: tab.project.id,
    workstreamId: tab.workstream.id,
    name: tab.name,
    folder: tab.project.folder,
  });
  const rosterDb = resolveDbPath(ctx.env);
  const command = buildLaunchCommand({
    wtPath: wtPath(ctx.env),
    name: tab.name,
    folder: tab.project.folder,
    role: tab.role,
    skipPermissions: warning === null,
    briefingFile: join(ctx.pluginRoot, 'briefings', `${tab.role}.md`),
    pluginDir: ctx.pluginRoot,
    settingsPath: join(dirname(rosterDb), 'sessions', `${session.id}.settings.json`),
    prompt: tab.prompt(session.id),
    sessionId: session.id,
    parentId: tab.parentId,
    rosterDb,
    worktree: tab.worktree,
  });
  ctx.deps.writeSettings(command.settings);
  const since = Date.now() - 1000;
  const result = await ctx.deps.run(command);
  if (result.code !== 0) {
    setSessionState(ctx.db, session.id, 'stopped');
    throw new Error(`Windows Terminal launch failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
  const pid = await ctx.deps.waitForPid(tab.name, since);
  if (pid === null) {
    warnings.push(`${tab.name} was launched but its process id was not found yet. Stopping it will look the id up again by name.`);
  } else {
    setSessionPid(ctx.db, session.id, pid);
  }
  return { session: requireSession(ctx.db, session.id), existing: false, warnings };
}

export async function launchArchitect(
  ctx: LaunchContext,
  input: { project: string; workstream?: string; goalId?: number; parentId: number | null },
): Promise<LaunchResult> {
  const project = requireProject(ctx.db, input.project);
  const workstream = requireWorkstream(ctx.db, project.id, input.workstream ?? 'main');
  const existing = runningArchitect(ctx.db, workstream.id);
  if (existing !== undefined) return { session: existing, existing: true, warnings: [] };
  if (input.goalId !== undefined && requireGoal(ctx.db, input.goalId).workstream_id !== workstream.id) {
    throw new Error(`Goal #${input.goalId} does not belong to ${project.name}/${workstream.name}`);
  }
  const result = await launchTab(ctx, {
    role: 'architect',
    project,
    workstream,
    name: sessionName(project.name, workstream.name),
    parentId: input.parentId,
    prompt: () => architectPrompt(project.name, workstream.name, input.goalId),
  });
  if (input.goalId !== undefined) updateGoal(ctx.db, input.goalId, { state: 'planning' });
  return result;
}

export async function launchDeveloper(
  ctx: LaunchContext,
  input: { architectId: number; task: string; label: string },
): Promise<LaunchResult> {
  const architect = requireSession(ctx.db, input.architectId);
  if (architect.role !== 'architect' || architect.project_id === null || architect.workstream_id === null) {
    throw new Error('Only an architect with a project workstream can launch developer sessions');
  }
  const project = requireProjectById(ctx.db, architect.project_id);
  const workstream = requireWorkstreamById(ctx.db, architect.workstream_id);
  const name = sessionName(project.name, workstream.name, 'dev', input.label);
  return launchTab(ctx, {
    role: 'developer',
    project,
    workstream,
    name,
    parentId: architect.id,
    prompt: (sessionId) => developerPrompt(project.name, workstream.name, input.task, sessionId),
    worktree: name,
  });
}

/** Stops running children first, then kills this session's process tree if (and only if) it is ours. */
export async function stopSession(ctx: LaunchContext, sessionId: number): Promise<StopResult> {
  const session = requireSession(ctx.db, sessionId);
  if (session.role === 'front-desk') throw new Error('Multi-Manager does not stop the front desk');
  const warnings: string[] = [];
  for (const child of runningChildren(ctx.db, session.id)) {
    warnings.push(...(await stopSession(ctx, child.id)).warnings);
  }
  const label = session.name ?? `session #${session.id}`;
  let killed = false;
  const pid = session.pid ?? (session.name === null ? null : ctx.deps.findPid(session.name));
  if (pid === null) {
    warnings.push(`No process id is known for ${label}. It was marked stopped without killing anything.`);
  } else if (session.name === null || !(await ctx.deps.ownsProcess(pid, session.name))) {
    warnings.push(`Process ${pid} is not ${label}'s claude.exe any more, so nothing was killed.`);
  } else {
    const result = await ctx.deps.run(buildStopCommand(pid));
    killed = result.code === 0;
    if (!killed) warnings.push(`taskkill exited with ${result.code}: ${result.stderr || result.stdout}`);
  }
  setSessionState(ctx.db, session.id, 'stopped');
  releaseAll(ctx.db, session.id);
  return { session: requireSession(ctx.db, session.id), killed, warnings };
}

export async function stopArchitect(ctx: LaunchContext, input: { project: string; workstream?: string }): Promise<StopResult> {
  const project = requireProject(ctx.db, input.project);
  const workstream = requireWorkstream(ctx.db, project.id, input.workstream ?? 'main');
  const architect = runningArchitect(ctx.db, workstream.id);
  if (architect === undefined) throw new Error(`No running architect for ${project.name}/${workstream.name}`);
  return stopSession(ctx, architect.id);
}
```

**Step 4: run.** Expect PASS (`ℹ pass 9`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/launch/launcher.ts test/launcher.test.ts
git commit -m "feat(launch): launch and stop architect and developer tabs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: Hooks (R5, AC5)

Hook output formats come from the Claude Code hooks reference (code.claude.com/docs/en/hooks), checked 2026-10-21. SessionStart takes `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`. Stop takes `{"decision":"block","reason":"…"}`. The entry scripts check `MM_SESSION_ID` **before** importing anything that loads `node:sqlite`, so in ordinary Claude sessions they do nothing and print nothing.

### [ ] Task 5.1: SessionStart hook <!-- deps: 3.5, parallel: pg-5 -->

- **Type**: code
- **Spec**: R5 SessionStart ("check in; add open items addressed to this session to the context"; "active only when `MM_SESSION_ID` is set")
- **Acceptance**: `test/session-start-hook.test.ts` passes. With `MM_SESSION_ID` set, the hook checks in, lists the open and answered items addressed to the session in `additionalContext`, and marks them seen. Without it, the hook returns null and creates no database file. The entry script prints nothing when `MM_SESSION_ID` is unset.

**Files:** Create `src/hooks/common.ts`, `src/hooks/session-start.ts`, `scripts/session-start-hook.ts`, `test/session-start-hook.test.ts`

**Step 1: failing test** `test/session-start-hook.test.ts`:

```ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runSessionStartHook } from '../src/hooks/session-start.ts';
import { getItem, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { getSession, registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempDir, tempRoster } from './helpers.ts';

test('SessionStart checks in and puts open items for this session into context', (t) => {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' }, new Date('2026-10-21T08:00:00.000Z'));
  const item = raiseItem(db, { kind: 'question', body: 'Use Postgres?', addressedTo: arch.id, raisedBy: desk.id });
  const env = { MM_SESSION_ID: String(arch.id), MM_ROLE: 'architect', MM_ROSTER_DB: process.env.MM_ROSTER_DB };
  const now = new Date('2026-10-21T09:00:00.000Z');
  const output = runSessionStartHook(env, now);
  assert.equal(output?.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output?.hookSpecificOutput.additionalContext ?? '', new RegExp(`roster session #${arch.id} \\(architect\\)`));
  assert.match(output?.hookSpecificOutput.additionalContext ?? '', new RegExp(`#${item.id} \\[question, open\\] Use Postgres\\?`));
  assert.equal(getSession(db, arch.id)?.last_checkin_at, now.toISOString());
  assert.equal(getItem(db, item.id)?.seen, 1);
});

test('SessionStart does nothing without MM_SESSION_ID and creates no database', (t) => {
  const path = join(tempDir(t), 'never.db');
  assert.equal(runSessionStartHook({ MM_ROSTER_DB: path }), null);
  assert.equal(existsSync(path), false);
});

test('the SessionStart entry script is silent outside Multi-Manager sessions', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MM_')));
  const result = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'session-start-hook.ts')], { env, input: '{}', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement**

`src/hooks/common.ts`:

```ts
import type { Env } from '../roster/db.ts';

/** The roster id set at launch through --settings env, or null outside Multi-Manager sessions. */
export function sessionIdFromEnv(env: Env): number | null {
  const raw = env.MM_SESSION_ID;
  if (raw === undefined || raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
```

`src/hooks/session-start.ts`:

```ts
import { openRoster, resolveDbPath, type Env } from '../roster/db.ts';
import { formatItem, markSeen, openItemsFor } from '../roster/items.ts';
import { checkIn, getSession } from '../roster/sessions.ts';
import { sessionIdFromEnv } from './common.ts';

export interface SessionStartOutput {
  hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string };
}

export function runSessionStartHook(env: Env, now: Date = new Date()): SessionStartOutput | null {
  const sessionId = sessionIdFromEnv(env);
  if (sessionId === null) return null;
  const db = openRoster(resolveDbPath(env));
  try {
    if (getSession(db, sessionId) === undefined) return null;
    checkIn(db, sessionId, now);
    const items = openItemsFor(db, sessionId);
    markSeen(db, items.map((item) => item.id));
    const lines = [`Multi-Manager: you are roster session #${sessionId} (${env.MM_ROLE ?? 'unknown role'}).`];
    if (items.length === 0) {
      lines.push('No open roster items are addressed to you.');
    } else {
      lines.push('Open roster items addressed to you (act on them; close them with close_item when done):');
      for (const item of items) lines.push(formatItem(item));
    }
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } };
  } finally {
    db.close();
  }
}
```

`scripts/session-start-hook.ts`:

```ts
// Plugin SessionStart hook. No-op unless MM_SESSION_ID is set (R5); node:sqlite is only loaded when it is.
if (process.env.MM_SESSION_ID) {
  const { runSessionStartHook } = await import('../src/hooks/session-start.ts');
  const output = runSessionStartHook(process.env);
  if (output !== null) process.stdout.write(JSON.stringify(output));
}
```

**Step 4: run.** Expect PASS (`ℹ pass 3`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/hooks/common.ts src/hooks/session-start.ts scripts/session-start-hook.ts test/session-start-hook.test.ts
git commit -m "feat(hooks): SessionStart check-in with open roster items" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 5.2: Stop hook (block once per unseen batch) <!-- deps: 5.1, parallel: pg-6 -->

- **Type**: code
- **Spec**: R5 Stop ("check in; if there are unseen items addressed to this session, block the stop once with a reason listing them and mark them seen"), AC5
- **Acceptance**: `test/stop-hook.test.ts` passes. It **blocks once** when unseen items exist, with a reason that lists them. It **does not block the second time**. A newly answered item blocks once more. It **does nothing when `MM_SESSION_ID` is unset**, both in-process (no DB file created) and as a subprocess (exit 0, no stdout). The subprocess also produces a real block JSON when the variable is set.

**Files:** Create `src/hooks/stop.ts`, `scripts/stop-hook.ts`, `test/stop-hook.test.ts`

**Step 1: failing test** `test/stop-hook.test.ts`:

```ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { runStopHook } from '../src/hooks/stop.ts';
import { answerItem, getItem, raiseItem } from '../src/roster/items.ts';
import { addProject, requireWorkstream } from '../src/roster/projects.ts';
import { getSession, registerSession, startFrontDesk } from '../src/roster/sessions.ts';
import { tempDir, tempRoster } from './helpers.ts';

const script = join(import.meta.dirname, '..', 'scripts', 'stop-hook.ts');

function setup(t: TestContext) {
  const db = tempRoster(t);
  const desk = startFrontDesk(db);
  const project = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  const main = requireWorkstream(db, project.id, 'main');
  const arch = registerSession(db, { role: 'architect', parentId: desk.id, projectId: project.id, workstreamId: main.id, name: 'mm-alpha-main' });
  const env = { MM_SESSION_ID: String(arch.id), MM_ROLE: 'architect', MM_ROSTER_DB: process.env.MM_ROSTER_DB };
  return { db, desk, arch, env };
}

test('blocks once when unseen items exist, then lets the session stop', (t) => {
  const { db, desk, arch, env } = setup(t);
  const item = raiseItem(db, { kind: 'question', body: 'Which database?', raisedBy: desk.id, addressedTo: arch.id });
  const now = new Date('2026-10-21T09:30:00.000Z');
  const first = runStopHook(env, now);
  assert.equal(first?.decision, 'block');
  assert.match(first?.reason ?? '', new RegExp(`#${item.id} \\[question, open\\] Which database\\?`));
  assert.equal(getItem(db, item.id)?.seen, 1);
  assert.equal(getSession(db, arch.id)?.last_checkin_at, now.toISOString());
  assert.equal(runStopHook(env), null);
});

test('an answer to the architect\'s sign-off blocks once more, with the verbatim answer', (t) => {
  const { db, arch, env } = setup(t);
  const signoff = raiseItem(db, { kind: 'signoff', body: 'Plan v1', raisedBy: arch.id });
  assert.equal(runStopHook(env), null); // addressed to the front desk, not to the architect
  answerItem(db, signoff.id, 'Approved; add one e2e test.');
  const blocked = runStopHook(env);
  assert.match(blocked?.reason ?? '', /Answer \(verbatim\): Approved; add one e2e test\./);
  assert.equal(runStopHook(env), null);
});

test('does nothing when MM_SESSION_ID is unset', (t) => {
  const path = join(tempDir(t), 'never.db');
  assert.equal(runStopHook({ MM_ROSTER_DB: path }), null);
  assert.equal(existsSync(path), false);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MM_')));
  const result = spawnSync(process.execPath, [script], { env, input: '{}', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('the entry script prints a block decision for a Multi-Manager session', (t) => {
  const { db, desk, arch, env } = setup(t);
  raiseItem(db, { kind: 'info', body: 'Front desk restarted', raisedBy: desk.id, addressedTo: arch.id });
  const result = spawnSync(process.execPath, [script], { env: { ...process.env, ...env }, input: '{"stop_hook_active":false}', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { decision: string; reason: string };
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /Front desk restarted/);
});
```

**Step 2: run.** Expect FAIL.

**Step 3: implement**

`src/hooks/stop.ts`:

```ts
import { openRoster, resolveDbPath, type Env } from '../roster/db.ts';
import { formatItem, markSeen, unseenItemsFor } from '../roster/items.ts';
import { checkIn, getSession } from '../roster/sessions.ts';
import { sessionIdFromEnv } from './common.ts';

export interface StopOutput {
  decision: 'block';
  reason: string;
}

/** Blocks at most once per batch of unseen items: they are marked seen as they are reported. */
export function runStopHook(env: Env, now: Date = new Date()): StopOutput | null {
  const sessionId = sessionIdFromEnv(env);
  if (sessionId === null) return null;
  const db = openRoster(resolveDbPath(env));
  try {
    if (getSession(db, sessionId) === undefined) return null;
    checkIn(db, sessionId, now);
    const unseen = unseenItemsFor(db, sessionId);
    if (unseen.length === 0) return null;
    markSeen(db, unseen.map((item) => item.id));
    return {
      decision: 'block',
      reason: [
        'New Multi-Manager roster items are addressed to you. Read them with the roster list_items tool, act on them, then stop:',
        ...unseen.map(formatItem),
      ].join('\n'),
    };
  } finally {
    db.close();
  }
}
```

`scripts/stop-hook.ts`:

```ts
// Plugin Stop hook. No-op unless MM_SESSION_ID is set (R5); node:sqlite is only loaded when it is.
if (process.env.MM_SESSION_ID) {
  const { runStopHook } = await import('../src/hooks/stop.ts');
  const output = runStopHook(process.env);
  if (output !== null) process.stdout.write(JSON.stringify(output));
}
```

**Step 4: run.** Expect PASS (`ℹ pass 4`). Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/hooks/stop.ts scripts/stop-hook.ts test/stop-hook.test.ts
git commit -m "feat(hooks): Stop hook blocks once per batch of unseen roster items" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 5.3: `hooks/hooks.json` <!-- deps: 5.2, parallel: pg-7 -->

- **Type**: config
- **Spec**: R1 ("Hooks that keep sessions in touch with the roster"), R5
- **Acceptance**: `test/hooks-config.test.ts` passes. SessionStart and Stop each run `node` on a script that exists, using `${CLAUDE_PLUGIN_ROOT}`.

**Files:** Create `hooks/hooks.json`, `test/hooks-config.test.ts`

**Step 1: failing test** `test/hooks-config.test.ts`:

```ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');

interface HookConfig {
  hooks: Record<string, { hooks: { type: string; command: string; args: string[]; timeout: number }[] }[]>;
}

test('SessionStart and Stop run our node scripts through CLAUDE_PLUGIN_ROOT', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')) as HookConfig;
  assert.deepEqual(Object.keys(config.hooks).sort(), ['SessionStart', 'Stop']);
  for (const [event, script] of [['SessionStart', 'session-start-hook.ts'], ['Stop', 'stop-hook.ts']]) {
    const hook = config.hooks[event][0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, 'node');
    assert.deepEqual(hook.args, [`\${CLAUDE_PLUGIN_ROOT}/scripts/${script}`]);
    assert.ok(existsSync(join(root, 'scripts', script)));
  }
});
```

**Step 2: run.** Expect FAIL (`ENOENT … hooks.json`).

**Step 3: create** `hooks/hooks.json`. This uses the exec form (`command` + `args`), as the Claude Code hooks reference documents; it avoids shell quoting of `Dropbox (Personal)`.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/session-start-hook.ts"], "timeout": 15 }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/stop-hook.ts"], "timeout": 15 }
        ]
      }
    ]
  }
}
```

**Step 4: run.** Expect PASS (`ℹ pass 1`).

**Step 5: commit**

```
git add hooks/hooks.json test/hooks-config.test.ts
git commit -m "feat(plugin): register SessionStart and Stop hooks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6: Plugin surface: briefings, manifest, commands, MCP server (R1, R3, R6)

Roster tool names are fixed here. The briefings and commands use these short names, and Claude Code exposes them as `mcp__plugin_multi-manager_roster__<tool>`:
`start_front_desk, get_briefing, add_project, list_projects, add_workstream, list_workstreams, register_session, check_in, list_sessions, create_goal, update_goal, get_goal, raise_item, answer_item, close_item, list_items, mark_seen, claim, release, report_spend, status, launch_architect, stop_architect, launch_developer, stop_developer`.

### [ ] Task 6.1: Role briefings <!-- deps: 2.1, parallel: pg-1 -->

- **Type**: docs (this is the product)
- **Spec**: R6 (front desk, architect, developer), R1 ("Role briefings")
- **Acceptance**: `test/briefings.test.ts` passes. Each briefing has the R6 duties as checkable phrases, and each stays under 4,000 characters so it remains tight.

**Files:** Create `briefings/front-desk.md`, `briefings/architect.md`, `briefings/developer.md`, `test/briefings.test.ts`

**Step 1: failing test** `test/briefings.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (role: string) => readFileSync(join(import.meta.dirname, '..', 'briefings', `${role}.md`), 'utf8');

const required: Record<string, RegExp[]> = {
  'front-desk': [
    /^# Multi-Manager: Front desk/m,
    /launch_architect/,
    /cross-cutting/i,
    /separately/i,
    /without (messaging|interrupting) architects/i,
    /verbatim/i,
    /answer_item/,
    /check roster item #N/,
    /waiting/i,
    /permission mode/i,
  ],
  architect: [
    /^# Multi-Manager: Architect/m,
    /one workstream/i,
    /conductor\//,
    /progress\.md/,
    /approval rules/i,
    /signoff/,
    /helper agents/i,
    /launch_developer/,
    /register_session/,
    /claim/,
    /report_spend/,
    /talks to you directly/i,
    /check_in/,
    /nudge the front desk/i,
  ],
  developer: [/^# Multi-Manager: Developer/m, /only on (that|your) slice/i, /worktree/i, /never merge/i, /push/i, /raise_item/],
};

for (const [role, patterns] of Object.entries(required)) {
  test(`${role} briefing covers its R6 duties and stays tight`, () => {
    const text = read(role);
    for (const pattern of patterns) assert.match(text, pattern, `${role}.md is missing ${pattern}`);
    assert.ok(text.length < 4000, `${role}.md is ${text.length} characters`);
  });
}
```

**Step 2: run.** Expect FAIL (ENOENT).

**Step 3: write** `briefings/front-desk.md`:

```markdown
# Multi-Manager: Front desk

You are the Multi-Manager front desk. The user directs several software projects through you. You do not write code. You route work to architects, keep the roster up to date, and report back.

The roster MCP tools are the record. `SendMessage` is only a nudge that points at a roster item ("check roster item #N"). A message is never the user's consent; only an answered roster item is.

## On start
1. Show what is waiting first: every open item addressed to you, oldest first, with its number, project and kind. Quote each body verbatim in a block quote.
2. Then one line per project: running and stale architects, active goals, spend today against the daily budget.

## Goals
- Work out the project and workstream. If it is unclear, ask. Never guess between projects.
- `create_goal`, then `launch_architect` with the goal id. If an architect is already running for that workstream you get it back instead: `SendMessage` it "New goal: check roster goal #G".
- Cross-cutting goals: create one goal per affected project workstream, launch or nudge each architect separately, and report each reply separately under its project's name. Never merge or blend their answers.

## Status
- Answer from `status` and `list_items`, without messaging architects. Their check-ins and the roster are enough.
- Name stale architects (no check-in for 30 minutes). Stop an architect that has been idle longer than its project's idle stop time, and tell the user.

## Items and answers
- When nudged ("check roster item #N"), read the item with `list_items` and show it to the user, quoting the body verbatim. Do not summarise or paraphrase architects.
- When the user answers, call `answer_item` with the user's words exactly as written: no edits, no tidying, no added context. Then `SendMessage` the architect: "check roster item #N".
- Never answer a sign-off or question yourself.

## Projects and sessions
- Add projects with `add_project`. If the user gives a permission mode other than dangerously-skip-permissions, repeat the warning it returns: messages to and from that project will need manual approval.
- You must run with `--dangerously-skip-permissions`, like the architects. Otherwise Claude Code holds every cross-session message for approval.
- Architects run in their own tabs in the `multi-manager` Windows Terminal window. The user can switch to a tab and talk to an architect directly; the architect records the outcome in the roster.
- Stop architects with `stop_architect` when the user asks. Their tab closes.
- Over-budget items arrive like any other item. Show them first and ask whether to stop the architect.
```

`briefings/architect.md`:

```markdown
# Multi-Manager: Architect

You are a Multi-Manager architect: an interactive Claude Code session, in its own Windows Terminal tab, that owns one workstream of one project. You plan, delegate, test and report. The user directs you through the front desk, and sometimes talks to you directly in this tab.

Your roster identity comes from the environment (`MM_SESSION_ID`, `MM_ROLE`). The roster MCP tools are the record. `SendMessage` is only a nudge; the content lives in the roster. The front desk's session name is in `list_sessions` (role `front-desk`), usually `mm-front-desk`.

## Start
1. `get_goal` for the goal named in your first prompt, and `list_items` for anything addressed to you.
2. Read the project's approval rules from `list_projects`. By default the user signs off on the high-level plan and the high-level testing approach.
3. Keep your plan and progress log in the project, in `conductor/` format: `conductor/tracks/<goal-slug>/spec.md`, `plan.md` (`[ ]`/`[x]` tasks) and `progress.md` (an append-only, dated log). This log is the source of truth.

## Each goal
1. `update_goal` to `planning`. Write the plan and the testing approach: unit tests, end-to-end tests, and your own browser click-through of every user-facing change, judging UI design and flow.
2. For large or unfamiliar work, farm research and planning out to helper agents (or developer sessions for long jobs), then merge their findings into your plan.
3. Raise sign-offs as the approval rules require: `raise_item` kind `signoff`, with the plan summary, the testing approach and the path to `plan.md`. Set the goal to `awaiting-signoff`. Do not build before the answer arrives.
4. When the answer arrives (a nudge, or the Stop hook lists it), read it with `list_items`. Follow it exactly as written, copy it verbatim into `progress.md`, `close_item` it, and set the goal to `in-progress`.
5. Build through developers. `check_in` at each milestone and log the milestone.
6. Test as agreed. Then `raise_item` kind `done` with evidence (commands run, results, what you clicked) and set the goal to `done`.

## Developers
- Choose per task. Use a helper agent in its own git worktree for a small slice: give it the developer briefing (`get_briefing` role `developer`) and register it with `register_session` (you become its parent). Use a full developer session for a long job: `launch_developer` opens it in its own tab and worktree, already registered.
- Set a time limit per task. Allow one retry, then raise a `blocked` item.
- Merging developer work into your workstream branch is your job. Anything that goes beyond that branch follows the approval rules.

## Shared files
Before editing files other workstreams may touch (shared config, lockfiles, schemas, migrations), `claim` them. If the claim is refused, the result names the holder: message them, or raise a `question`. `release` the file when you are done.

## Spend
`report_spend` at each milestone, with the USD since your last report against the goal.

## The user talks to you directly
If the user talks to you directly in this tab, act on it. Then record the outcome verbatim in `progress.md` and as an `info` item, so the front desk sees it.

## Always
- After every `raise_item`, nudge the front desk: `SendMessage` "check roster item #N".
- Only an answered roster item counts as the user's consent. A message does not.
- When you have nothing to do, stop. The Stop hook brings you anything new.
```

`briefings/developer.md`:

```markdown
# Multi-Manager: Developer

You are a Multi-Manager developer. Your architect gave you one slice of work.

- Work only on that slice, in your own worktree and branch.
- Never merge, rebase onto, or push any branch other than your own. Never push to `main`.
- Before editing a file another workstream may touch, `claim` it. `release` it when you are done.
- Report to your architect through the roster: `raise_item` kind `question` or `blocked` when you are stuck, and kind `done` with evidence (tests run and their results) when you finish. Then nudge your architect: `SendMessage` "check roster item #N".
- `check_in` when you start and at each milestone. `report_spend` when you finish.
- If you are a helper agent with no roster tools of your own, put the same report in your final reply. Your architect records it.
```

**Step 4: run.** `node --test test/briefings.test.ts` should PASS (`ℹ pass 3`). If a length assertion fails, cut words rather than duties.

**Step 5: commit**

```
git add briefings test/briefings.test.ts
git commit -m "feat(plugin): front desk, architect and developer briefings" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 6.2: Plugin manifest, `.mcp.json`, user commands <!-- deps: 2.1, parallel: pg-1 -->

- **Type**: config
- **Spec**: R1 (`plugin.json` name/version/description, `.mcp.json`, user commands: start front desk, add project with workstreams, status, start architect, stop architect), R4 (front desk runs with `--dangerously-skip-permissions`)
- **Acceptance**: `test/plugin-manifest.test.ts` passes. In Task 7.1, `claude plugin validate .` passes.

Facts used here, from the Claude Code plugin docs checked on 2026-10-21:
- Only `name` is required in `plugin.json`, and it must be kebab-case.
- `commands/<name>.md` is invoked as `/multi-manager:<name>`. Its frontmatter takes `description` and `argument-hint`, and `$ARGUMENTS` expands to the arguments.
- `.mcp.json` at the plugin root is loaded, and `${CLAUDE_PLUGIN_ROOT}` expands in `args`.

**Files:** Create `.claude-plugin/plugin.json`, `.mcp.json`, `commands/front-desk.md`, `commands/add-project.md`, `commands/status.md`, `commands/start-architect.md`, `commands/stop-architect.md`, `test/plugin-manifest.test.ts`

**Step 1: failing test** `test/plugin-manifest.test.ts`:

```ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');
const json = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;

test('plugin.json names the multi-manager plugin', () => {
  const manifest = json('.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'multi-manager');
  assert.match(String(manifest.version), /^\d+\.\d+\.\d+$/);
  assert.ok(String(manifest.description).length > 20);
});

test('.mcp.json starts the roster server with node from the plugin root', () => {
  const servers = json('.mcp.json').mcpServers as Record<string, { command: string; args: string[] }>;
  assert.deepEqual(servers.roster, { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/roster/server.ts'] });
});

test('every user command exists, has a description and names its roster tool', () => {
  const commands: Record<string, string> = {
    'front-desk': 'start_front_desk',
    'add-project': 'add_project',
    status: 'status',
    'start-architect': 'launch_architect',
    'stop-architect': 'stop_architect',
  };
  for (const [name, tool] of Object.entries(commands)) {
    const path = join(root, 'commands', `${name}.md`);
    assert.ok(existsSync(path), `missing commands/${name}.md`);
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^---\ndescription: .+\n/, `${name}.md needs a description`);
    assert.ok(text.includes(`\`${tool}\``), `${name}.md should name \`${tool}\``);
  }
  assert.match(readFileSync(join(root, 'commands', 'front-desk.md'), 'utf8'), /--dangerously-skip-permissions/);
});
```

On Windows, `core.autocrlf` can give these files CRLF line endings in the working tree. If the frontmatter regex fails for that reason, add a `.gitattributes` with `*.md text eol=lf` and re-checkout the files. Do not loosen the test.

**Step 2: run.** Expect FAIL.

**Step 3: create the files.**

`.claude-plugin/plugin.json`:

```json
{
  "name": "multi-manager",
  "version": "0.1.0",
  "description": "One front desk session that directs architect sessions across several projects, each in its own Windows Terminal tab, through a shared roster.",
  "author": { "name": "zakhodgsonamauk" },
  "keywords": ["orchestration", "multi-session", "roster", "windows"]
}
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "roster": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/src/roster/server.ts"]
    }
  }
}
```

`commands/front-desk.md`:

```markdown
---
description: Make this session the Multi-Manager front desk
---
Make this session the Multi-Manager front desk.

1. Call the roster tool `start_front_desk`. Pass `name` only if this session was started with a `-n` name other than `mm-front-desk`.
2. Follow the briefing it returns for the rest of this session.
3. Start by showing everything waiting, as the briefing says.

The front desk must run in the same permission mode as the architects, or Claude Code holds every cross-session message for manual approval. If this session was not started like this, tell the user to restart it this way:

`claude -n mm-front-desk --dangerously-skip-permissions --plugin-dir "<multi-manager folder>"`
```

`commands/add-project.md`:

```markdown
---
description: Add a project and its workstreams to the Multi-Manager roster
argument-hint: <name> <folder>
---
Add a project to the Multi-Manager roster. Arguments: $ARGUMENTS

Ask only for what is missing: name; folder (absolute path); extra workstreams with their branches (every project gets `main` on branch `main` unless told otherwise); approval rules; permission mode; idle stop minutes; daily budget in USD. Offer the defaults and accept them if the user does not care. The defaults are: sign-off on the high-level plan and testing approach; dangerously-skip-permissions; 120 minutes; no budget.

Then call the roster tool `add_project` and show the result. If it returns a warning, show it verbatim.
```

`commands/status.md`:

```markdown
---
description: Show Multi-Manager status from the roster
---
Call the roster tool `status`. Show waiting items first, with each body quoted verbatim. Then give one short block per project: workstreams with their architect (stale or not), active goals with spend against budget, open items, and spend today. Do not message any architect to build this answer.
```

`commands/start-architect.md`:

```markdown
---
description: Start (or reuse) the architect for a project workstream, optionally with a goal
argument-hint: <project> [workstream] [goal text]
---
Start an architect. Arguments: $ARGUMENTS

1. Work out the project, the workstream (default `main`) and any goal text. Ask if the project is unclear.
2. If there is goal text, call `create_goal` first.
3. Call the roster tool `launch_architect` with the project, workstream and goal id.
4. Report the tab name (`mm-<project>-<workstream>`) and whether it was already running. Show any warnings verbatim. If it was already running and there is a new goal, `SendMessage` it "New goal: check roster goal #G".
```

`commands/stop-architect.md`:

```markdown
---
description: Stop the architect for a project workstream and close its tab
argument-hint: <project> [workstream]
---
Stop an architect. Arguments: $ARGUMENTS

Confirm the project and workstream (default `main`), then call the roster tool `stop_architect`. Report whether its process was killed (its tab closes) and show any warnings verbatim. The architect's developer sessions are stopped too.
```

**Step 4: run.** `node --test test/plugin-manifest.test.ts` should PASS (`ℹ pass 3`).

**Step 5: commit**

```
git add .claude-plugin/plugin.json .mcp.json commands test/plugin-manifest.test.ts
git commit -m "feat(plugin): manifest, roster MCP registration and user commands" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 6.3: Roster MCP tools and server <!-- deps: 3.8, 4.5, 5.1, 6.1, parallel: pg-7 -->

- **Type**: integration
- **Spec**: R3 (stdio MCP server; identity from `MM_SESSION_ID`/`MM_ROLE`; tools for projects/workstreams, sessions/check-in/tree, goals, items, claims, spend, status, launch architect, stop architect), R4 (launch/stop via the launcher), R6 (front desk gets its briefing)
- **Acceptance**: `test/server.test.ts` passes. The real server, started over stdio with a temp `MM_ROSTER_DB`, lists all 25 tools. `start_front_desk` returns the front-desk briefing. An add-project, raise, answer and status round trip keeps the answer verbatim. Calling a tool that needs an identity before registering gives a clear error.

**Unverified API note:** this targets `@modelcontextprotocol/sdk` 1.32 (`McpServer.registerTool(name, { description, inputSchema: <zod raw shape> }, handler)`), as pinned in Task 2.1. If `tsc` rejects the handler return type, annotate the handlers with `CallToolResult` from `@modelcontextprotocol/sdk/types.js`. That is already imported below.

**Files:** Create `src/roster/tools.ts`, `src/roster/server.ts`, `test/server.test.ts`

**Step 1: failing test** `test/server.test.ts`:

```ts
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tempDir } from './helpers.ts';

const serverPath = join(import.meta.dirname, '..', 'src', 'roster', 'server.ts');

const ALL_TOOLS = [
  'add_project', 'add_workstream', 'answer_item', 'check_in', 'claim', 'close_item', 'create_goal', 'get_briefing',
  'get_goal', 'launch_architect', 'launch_developer', 'list_items', 'list_projects', 'list_sessions', 'list_workstreams',
  'mark_seen', 'raise_item', 'register_session', 'release', 'report_spend', 'start_front_desk', 'status',
  'stop_architect', 'stop_developer', 'update_goal',
];

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content.map((c) => c.text).join('\n');
}

test('the roster MCP server exposes every tool and round-trips a verbatim answer', async (t) => {
  const dir = tempDir(t);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('MM_')) env[key] = value;
  env.MM_ROSTER_DB = join(dir, 'roster.db');
  env.LOCALAPPDATA = dir; // start_front_desk installs the Terminal fragment here, not in the real profile
  const client = new Client({ name: 'roster-smoke-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'pipe' }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ALL_TOOLS);

    const early = await client.callTool({ name: 'check_in', arguments: {} });
    assert.equal(early.isError, true);
    assert.match(text(early), /not registered with the roster/);

    assert.match(text(await client.callTool({ name: 'start_front_desk', arguments: {} })), /# Multi-Manager: Front desk/);
    await client.callTool({ name: 'add_project', arguments: { name: 'smoke', folder: dir } });
    const raised = JSON.parse(text(await client.callTool({ name: 'raise_item', arguments: { kind: 'question', body: 'Ship it?' } }))) as {
      item: { id: number };
    };
    const words = 'Yes — but only after the e2e run; thanks.';
    const answered = JSON.parse(text(await client.callTool({ name: 'answer_item', arguments: { item_id: raised.item.id, answer: words } }))) as {
      item: { answer: string };
    };
    assert.equal(answered.item.answer, words);

    const status = JSON.parse(text(await client.callTool({ name: 'status', arguments: {} }))) as { projects: { name: string }[] };
    assert.deepEqual(status.projects.map((p) => p.name), ['smoke']);
  } finally {
    await client.close();
  }
});
```

**Step 2: run.** Expect FAIL. The server file does not exist yet, so the client connection fails, with a message like `Connection closed` or `MCP error -32000`.

**Step 3: implement** `src/roster/tools.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { sessionIdFromEnv } from '../hooks/common.ts';
import { launchArchitect, launchDeveloper, permissionWarning, stopArchitect, stopSession, type LaunchContext } from '../launch/launcher.ts';
import { claim, release } from './claims.ts';
import type { Env } from './db.ts';
import { GOAL_STATES, createGoal, goalWithPlace, updateGoal } from './goals.ts';
import { ITEM_KINDS, ITEM_STATES, answerItem, closeItem, listItems, markSeen, raiseItem } from './items.ts';
import { addProject, addWorkstream, listProjects, listWorkstreams, requireProject, requireWorkstream } from './projects.ts';
import {
  FRONT_DESK_NAME,
  ROLES,
  checkIn,
  frontDesk,
  getSession,
  registerSession,
  requireSession,
  sessionTree,
  startFrontDesk,
  type Role,
  type Session,
} from './sessions.ts';
import { reportSpend, spendForGoal } from './spend.ts';
import { statusSummary } from './status.ts';

export interface Identity {
  sessionId: number | null;
  role: Role | null;
}

export interface ToolContext {
  db: DatabaseSync;
  identity: Identity;
  pluginRoot: string;
  launch: LaunchContext;
}

export function identityFromEnv(env: Env): Identity {
  const role = ROLES.find((r) => r === env.MM_ROLE) ?? null;
  return { sessionId: sessionIdFromEnv(env), role };
}

export function briefing(pluginRoot: string, role: Role): { role: Role; path: string; plugin_root: string; text: string } {
  const path = join(pluginRoot, 'briefings', `${role}.md`);
  return { role, path, plugin_root: pluginRoot, text: readFileSync(path, 'utf8') };
}

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

function me(ctx: ToolContext): Session {
  if (ctx.identity.sessionId === null) {
    throw new Error(
      'This session is not registered with the roster. Front desk: run /multi-manager:front-desk first. ' +
        'Architects and developers get their identity from the launcher.',
    );
  }
  return requireSession(ctx.db, ctx.identity.sessionId);
}

function projectIdFor(ctx: ToolContext, project: string | undefined): number {
  if (project !== undefined) return requireProject(ctx.db, project).id;
  const session = me(ctx);
  if (session.project_id === null) throw new Error('Name the project: this session has none');
  return session.project_id;
}

function nudge(ctx: ToolContext, sessionId: number, itemId: number): { to: string | null; message: string } {
  return { to: getSession(ctx.db, sessionId)?.name ?? null, message: `check roster item #${itemId}` };
}

export function registerRosterTools(server: McpServer, ctx: ToolContext): void {
  const { db } = ctx;

  server.registerTool(
    'start_front_desk',
    {
      description:
        'Make this session the Multi-Manager front desk (reuses the single front-desk record), install the Windows Terminal profile, and return the front-desk briefing plus the status with waiting items first.',
      inputSchema: { name: z.string().optional().describe('This session\'s -n name; default mm-front-desk') },
    },
    ({ name }) =>
      guard(() => {
        const desk = startFrontDesk(db, name ?? FRONT_DESK_NAME);
        ctx.identity = { sessionId: desk.id, role: 'front-desk' };
        ctx.launch.deps.ensureTerminalProfile();
        return [
          briefing(ctx.pluginRoot, 'front-desk').text,
          `## You are roster session #${desk.id} (${desk.name ?? FRONT_DESK_NAME})`,
          '## Status (waiting items first)',
          JSON.stringify(statusSummary(db), null, 2),
        ].join('\n\n');
      }),
  );

  server.registerTool(
    'get_briefing',
    { description: 'Return a role briefing (text and file path) and the plugin root.', inputSchema: { role: z.enum(ROLES) } },
    ({ role }) => guard(() => briefing(ctx.pluginRoot, role)),
  );

  server.registerTool(
    'add_project',
    {
      description: 'Add a project. It always gets a main workstream; pass more workstreams with their branches.',
      inputSchema: {
        name: z.string().min(1),
        folder: z.string().min(1).describe('Absolute path of the project folder'),
        permission_mode: z.string().optional().describe('Default dangerously-skip-permissions'),
        approval_rules: z.string().optional(),
        idle_stop_minutes: z.number().int().positive().optional(),
        daily_budget_usd: z.number().nonnegative().optional(),
        workstreams: z.array(z.object({ name: z.string().min(1), branch: z.string().min(1) })).optional(),
      },
    },
    (a) =>
      guard(() => {
        const project = addProject(db, {
          name: a.name,
          folder: a.folder,
          permissionMode: a.permission_mode,
          approvalRules: a.approval_rules,
          idleStopMinutes: a.idle_stop_minutes,
          dailyBudgetUsd: a.daily_budget_usd,
          workstreams: a.workstreams,
        });
        return { project, workstreams: listWorkstreams(db, project.name), warning: permissionWarning(project) };
      }),
  );

  server.registerTool('list_projects', { description: 'List all projects with their settings.', inputSchema: {} }, () =>
    guard(() => listProjects(db)),
  );

  server.registerTool(
    'add_workstream',
    { description: 'Add a workstream (name and branch) to a project.', inputSchema: { project: z.string(), name: z.string().min(1), branch: z.string().min(1) } },
    (a) => guard(() => addWorkstream(db, a.project, { name: a.name, branch: a.branch })),
  );

  server.registerTool(
    'list_workstreams',
    { description: 'List the workstreams of a project.', inputSchema: { project: z.string() } },
    ({ project }) => guard(() => listWorkstreams(db, project)),
  );

  server.registerTool(
    'register_session',
    {
      description: 'Register a session you start yourself (for example a helper-agent developer). You become its parent. Returns its roster id.',
      inputSchema: {
        role: z.enum(ROLES),
        project: z.string().optional(),
        workstream: z.string().optional(),
        name: z.string().optional(),
        folder: z.string().optional(),
      },
    },
    (a) =>
      guard(() => {
        const parent = me(ctx);
        const projectId = a.project !== undefined ? requireProject(db, a.project).id : parent.project_id;
        const workstreamId =
          a.workstream !== undefined && projectId !== null ? requireWorkstream(db, projectId, a.workstream).id : parent.workstream_id;
        return registerSession(db, { role: a.role, parentId: parent.id, projectId, workstreamId, name: a.name ?? null, folder: a.folder ?? null });
      }),
  );

  server.registerTool('check_in', { description: 'Record that this session is alive and working.', inputSchema: {} }, () =>
    guard(() => checkIn(db, me(ctx).id)),
  );

  server.registerTool(
    'list_sessions',
    { description: 'The session tree: front desk, architects, developers.', inputSchema: { include_stopped: z.boolean().optional() } },
    ({ include_stopped }) => guard(() => sessionTree(db, { includeStopped: include_stopped === true })),
  );

  server.registerTool(
    'create_goal',
    {
      description: 'Create a goal for a project workstream (default main).',
      inputSchema: { project: z.string(), workstream: z.string().optional(), text: z.string().min(1), budget_usd: z.number().nonnegative().optional() },
    },
    (a) =>
      guard(() => {
        const project = requireProject(db, a.project);
        const workstream = requireWorkstream(db, project.id, a.workstream ?? 'main');
        return createGoal(db, { workstreamId: workstream.id, text: a.text, budgetUsd: a.budget_usd });
      }),
  );

  server.registerTool(
    'update_goal',
    {
      description: 'Change a goal\'s state, text or budget.',
      inputSchema: { goal_id: z.number().int().positive(), state: z.enum(GOAL_STATES).optional(), text: z.string().optional(), budget_usd: z.number().nonnegative().optional() },
    },
    (a) => guard(() => updateGoal(db, a.goal_id, { state: a.state, text: a.text, budgetUsd: a.budget_usd })),
  );

  server.registerTool(
    'get_goal',
    { description: 'A goal with its project, workstream, spend and items.', inputSchema: { goal_id: z.number().int().positive() } },
    ({ goal_id }) =>
      guard(() => ({ goal: goalWithPlace(db, goal_id), spent_usd: spendForGoal(db, goal_id), items: listItems(db, { goalId: goal_id }) })),
  );

  server.registerTool(
    'raise_item',
    {
      description:
        'Raise a sign-off, question, blocker, done report or note. Goes to your parent session (architects: the front desk) unless addressed_to is given. Then SendMessage the returned nudge.',
      inputSchema: {
        kind: z.enum(ITEM_KINDS),
        body: z.string().min(1),
        goal_id: z.number().int().positive().optional(),
        addressed_to: z.number().int().positive().optional().describe('Roster session id'),
      },
    },
    (a) =>
      guard(() => {
        const item = raiseItem(db, { kind: a.kind, body: a.body, goalId: a.goal_id, raisedBy: ctx.identity.sessionId, addressedTo: a.addressed_to });
        return { item, nudge: nudge(ctx, item.addressed_to, item.id) };
      }),
  );

  server.registerTool(
    'answer_item',
    {
      description: 'Record the user\'s answer EXACTLY as the user wrote it (verbatim, unedited). The item goes back to whoever raised it. Then SendMessage the returned nudge.',
      inputSchema: { item_id: z.number().int().positive(), answer: z.string() },
    },
    (a) =>
      guard(() => {
        const item = answerItem(db, a.item_id, a.answer);
        return { item, nudge: nudge(ctx, item.addressed_to, item.id) };
      }),
  );

  server.registerTool(
    'close_item',
    { description: 'Close an item you have acted on.', inputSchema: { item_id: z.number().int().positive() } },
    ({ item_id }) => guard(() => closeItem(db, item_id)),
  );

  server.registerTool(
    'list_items',
    {
      description: 'List roster items. By default only items addressed to you that are not closed.',
      inputSchema: {
        mine_only: z.boolean().optional().describe('Default true'),
        states: z.array(z.enum(ITEM_STATES)).optional().describe('Default open and answered'),
        unseen_only: z.boolean().optional(),
        goal_id: z.number().int().positive().optional(),
      },
    },
    (a) =>
      guard(() =>
        listItems(db, {
          addressedTo: a.mine_only === false ? undefined : me(ctx).id,
          states: a.states ?? ['open', 'answered'],
          unseenOnly: a.unseen_only === true,
          goalId: a.goal_id,
        }),
      ),
  );

  server.registerTool(
    'mark_seen',
    { description: 'Mark items as seen.', inputSchema: { item_ids: z.array(z.number().int().positive()) } },
    ({ item_ids }) =>
      guard(() => {
        markSeen(db, item_ids);
        return { marked: item_ids };
      }),
  );

  server.registerTool(
    'claim',
    {
      description: 'Claim a shared file (or heavy-job name) in a project before editing it. A refusal names the holder.',
      inputSchema: { path: z.string().min(1), project: z.string().optional().describe('Default: your project') },
    },
    (a) => guard(() => claim(db, projectIdFor(ctx, a.project), a.path, me(ctx).id)),
  );

  server.registerTool(
    'release',
    { description: 'Release a claim you hold.', inputSchema: { path: z.string().min(1), project: z.string().optional() } },
    (a) => guard(() => ({ released: release(db, projectIdFor(ctx, a.project), a.path, me(ctx).id) })),
  );

  server.registerTool(
    'report_spend',
    {
      description: 'Report USD spent since your last report. Over-budget raises an item to the front desk.',
      inputSchema: { usd: z.number().nonnegative(), goal_id: z.number().int().positive().optional(), project: z.string().optional() },
    },
    (a) =>
      guard(() =>
        reportSpend(db, {
          usd: a.usd,
          sessionId: ctx.identity.sessionId,
          goalId: a.goal_id,
          projectId: a.project === undefined ? undefined : requireProject(db, a.project).id,
        }),
      ),
  );

  server.registerTool(
    'status',
    { description: 'Status summary: waiting items first, then per project workstreams, architects (stale?), active goals, open items, spend today.', inputSchema: {} },
    () => guard(() => statusSummary(db)),
  );

  server.registerTool(
    'launch_architect',
    {
      description: 'Open the architect for a project workstream (default main) in its own Windows Terminal tab, or return the running one.',
      inputSchema: { project: z.string(), workstream: z.string().optional(), goal_id: z.number().int().positive().optional() },
    },
    (a) =>
      guard(() =>
        launchArchitect(ctx.launch, {
          project: a.project,
          workstream: a.workstream,
          goalId: a.goal_id,
          parentId: ctx.identity.sessionId ?? frontDesk(db).id,
        }),
      ),
  );

  server.registerTool(
    'stop_architect',
    {
      description: 'Stop the architect for a project workstream (default main) and its developer sessions. Kills its process tree, so its tab closes.',
      inputSchema: { project: z.string(), workstream: z.string().optional() },
    },
    (a) => guard(() => stopArchitect(ctx.launch, { project: a.project, workstream: a.workstream })),
  );

  server.registerTool(
    'launch_developer',
    {
      description: 'Architects only: open a full developer session in its own tab and git worktree for a long job. Already registered under you.',
      inputSchema: { task: z.string().min(1), label: z.string().min(1).describe('Short name, used in the tab and worktree name') },
    },
    (a) => guard(() => launchDeveloper(ctx.launch, { architectId: me(ctx).id, task: a.task, label: a.label })),
  );

  server.registerTool(
    'stop_developer',
    { description: 'Stop one of your developer sessions and close its tab.', inputSchema: { session_id: z.number().int().positive() } },
    ({ session_id }) =>
      guard(() => {
        const caller = me(ctx);
        const target = requireSession(db, session_id);
        if (target.role !== 'developer' || (target.parent_id !== caller.id && caller.role !== 'front-desk')) {
          throw new Error(`Session #${session_id} is not one of your developers`);
        }
        return stopSession(ctx.launch, session_id);
      }),
  );
}
```

`src/roster/server.ts`:

```ts
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realDeps } from '../launch/runner.ts';
import { openRoster } from './db.ts';
import { identityFromEnv, registerRosterTools } from './tools.ts';

const pluginRoot = resolve(import.meta.dirname, '..', '..');
const db = openRoster();
const server = new McpServer({ name: 'multi-manager-roster', version: '0.1.0' });
registerRosterTools(server, {
  db,
  identity: identityFromEnv(process.env),
  pluginRoot,
  launch: { db, deps: realDeps(), pluginRoot, env: process.env },
});
await server.connect(new StdioServerTransport());
```

**Step 4: run.** `node --test test/server.test.ts` should PASS (`ℹ pass 1`). Then run the whole suite with `npm test`. Expected: `ℹ fail 0`. Typecheck and lint should be silent.

**Step 5: commit**

```
git add src/roster/tools.ts src/roster/server.ts test/server.test.ts
git commit -m "feat(roster): stdio MCP server exposing the roster tools" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7: Integration and end-to-end (R1, R7, AC2, AC6)

### [ ] Task 7.1: Full check, plugin validation, dev load, README <!-- deps: 5.3, 6.2, 6.3 -->

- **Type**: integration
- **Spec**: R1 ("Loadable for development with `claude --plugin-dir <repo>`"), R7, AC2
- **Acceptance**: `.claude\check.cmd` exits 0. `claude plugin validate .` reports no errors. A dev-loaded session shows `plugin:multi-manager:roster` connected and the five `/multi-manager:*` commands, and `/multi-manager:status` answers from an empty throwaway roster. The README explains setup and use.

**Files:** Create `scripts/dump-roster.ts`. Modify `README.md`.

**Step 1: roster dump script** `scripts/dump-roster.ts`. This is for manual checks in 7.2:

```ts
// Prints the whole roster as JSON for manual checks. Usage: node scripts/dump-roster.ts  (honours MM_ROSTER_DB)
import { openRoster } from '../src/roster/db.ts';

const db = openRoster();
const tables = ['projects', 'workstreams', 'sessions', 'goals', 'items', 'claims', 'spend'];
const dump = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
db.close();
console.log(JSON.stringify(dump, null, 2));
```

**Step 2: full check**

Run: `.claude\check.cmd`
Expected: `tsc` and `eslint` print nothing, and the test summary shows `ℹ fail 0` with about 60 tests passing. Exit code 0.

**Step 3: validate the plugin**

Run: `claude plugin validate .`
Expected: validation passes with no errors. This command comes from the docs and was not run during planning. If it reports a schema problem (for example in `hooks.json` exec-form `args`), fix the file it names and rerun Step 2.

**Step 4: dev load** in PowerShell. Use a throwaway roster:

```powershell
$env:MM_ROSTER_DB = "$env:TEMP\mm-devload\roster.db"
claude -n mm-front-desk --dangerously-skip-permissions --plugin-dir "I:\Dropbox (Personal)\Projects\multi-manager"
```
In the session:
- `/mcp`. Expected: `plugin:multi-manager:roster` is connected, with 25 tools.
- `/help` or type `/multi-manager:`. Expected: `front-desk`, `add-project`, `status`, `start-architect` and `stop-architect` are listed.
- `/multi-manager:status`. Expected: an empty roster (no projects, nothing waiting).
Then exit, and remove `$env:TEMP\mm-devload`.

**Step 5: README.** Replace the "Status: design approved…" paragraph with these sections, keeping the existing intro and the design links:

```markdown
Status: stage 1 (core) — front desk, roster, architects in Windows Terminal tabs. Windows 11 first.

## Setup (development)

Requires Node 25+, Claude Code 2.1.306+, Windows Terminal.

    npm install
    node scripts/install-terminal-profile.ts   # then restart Windows Terminal once
    .claude\check.cmd                          # type check, lint, tests

## Use

Start the front desk. It must use the same permission mode as the architects, or cross-session messages are held for approval:

    claude -n mm-front-desk --dangerously-skip-permissions --plugin-dir "<path to this repo>"

Then run `/multi-manager:front-desk`. Other commands: `/multi-manager:add-project`, `/multi-manager:status`,
`/multi-manager:start-architect`, `/multi-manager:stop-architect`. Architects open as tabs in the
`multi-manager` Windows Terminal window; switch to a tab to talk to one directly. Stopping an architect
closes its tab.

The roster lives at `~/.claude/multi-manager/roster.db` (override with `MM_ROSTER_DB`).
`node scripts/dump-roster.ts` prints it.
```

**Step 6: commit**

```
git add scripts/dump-roster.ts README.md
git commit -m "docs: setup and usage for stage 1; roster dump script" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### [ ] Task 7.2: Manual end-to-end check (AC6), record `e2e.md` <!-- deps: 7.1 -->

- **Type**: docs (manual: the user drives the front desk, or watches an agent do it)
- **Spec**: AC6, and through it R1 and R3–R6 in real use
- **Acceptance**: `conductor/tracks/core_20261021/e2e.md` records PASS for all 11 steps below, with evidence. Any FAIL goes to `## Discovered Work` as a fix task, and the track does not close until it passes.

**Step 1: throwaway setup** (PowerShell):

```powershell
$e2e = "$env:TEMP\mm-e2e"
New-Item -ItemType Directory -Force "$e2e\hello-site" | Out-Null
git -C "$e2e\hello-site" init
Set-Content "$e2e\hello-site\README.md" "# hello-site (Multi-Manager e2e throwaway)"
git -C "$e2e\hello-site" add . ; git -C "$e2e\hello-site" commit -m "init"
$env:MM_ROSTER_DB = "$e2e\roster.db"
cd 'I:\Dropbox (Personal)\Projects\multi-manager'
claude -n mm-front-desk --dangerously-skip-permissions --plugin-dir "I:\Dropbox (Personal)\Projects\multi-manager"
```

**Step 2: run the checks.** Write `conductor/tracks/core_20261021/e2e.md` from this template as you go:

```markdown
# Stage 1 end-to-end check (AC6)

Date: 2026-10-__ · Claude Code 2.1.306 · Node v25.x · Roster: %TEMP%\mm-e2e\roster.db
Run by: <name>

| # | Action (in the front desk unless stated) | Expected | Result | Evidence |
|---|---|---|---|---|
| 1 | `/multi-manager:front-desk` | Briefing loaded; "nothing waiting"; registered as roster session #N | PASS/FAIL | |
| 2 | `/multi-manager:add-project hello-site %TEMP%\mm-e2e\hello-site` (accept defaults) | Project with `main` workstream; no permission warning | PASS/FAIL | |
| 3 | "For hello-site: add an index.html that says Hello from Multi-Manager, with a test." | `create_goal` then `launch_architect`; tab `mm-hello-site-main` opens in the `multi-manager` window, in the project folder | PASS/FAIL | |
| 4 | `node scripts/dump-roster.ts` (separate PowerShell, same MM_ROSTER_DB) | Architect session row is `running` with a numeric `pid`; goal is `planning` | PASS/FAIL | |
| 5 | Wait for the architect | A `signoff` item (plan + testing approach) reaches the front desk by nudge or Stop-hook recovery; the front desk quotes it verbatim | PASS/FAIL | item #: |
| 6 | Answer exactly: `Approved — go ahead; keep it to one file. "No frameworks."` | `answer_item` stores it byte for byte (check with dump-roster); the front desk nudges the architect | PASS/FAIL | stored answer: |
| 7 | Watch the architect tab | It acts on the answer: closes the item, sets the goal to `in-progress`, logs the answer verbatim in `conductor/.../progress.md`, builds | PASS/FAIL | |
| 8 | "What's going on?" | Answer from `status` only (no message to the architect): workstream, architect check-in age, goal state, open items, spend today | PASS/FAIL | |
| 9 | Switch to the architect tab and type: "Also add a footer with today's date." | It does it, then records the outcome in `progress.md` and as an `info` item that the front desk can see | PASS/FAIL | |
| 10 | "Stop the hello-site architect." | `stop_architect` kills the tree; the tab **disappears completely** (no "process exited" text); the session is `stopped` in the roster | PASS/FAIL | |
| 11 | `/multi-manager:status` | No architect running for hello-site/main; the goal and items history remain | PASS/FAIL | |

## Notes / problems found
-

## Verdict
PASS / FAIL: <reason>
```

**Step 3: clean up.** `Remove-Item -Recurse -Force "$env:TEMP\mm-e2e"`, after the tab is closed and nothing holds the database open.

**Step 4: commit**

```
git add conductor/tracks/core_20261021/e2e.md
git commit -m "docs: record stage 1 end-to-end check" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Assumptions and unverified facts

These were decided during planning. The plan evaluator should check them. The executor must confirm or adjust the items marked "verify" at the step named.

1. **Spike verifies the launch model** (Task 1.2). This covers: how `wt.exe` quotes arguments with spaces; whether `--settings` file env reaches the MCP server, hooks and shell; whether the session file's `name` equals `-n`; and whether `taskkill /T /F` on `claude.exe` closes the tab when the profile has `closeOnExit: always`.
2. **`--settings <file path>` instead of inline JSON** (Task 4.1). This avoids `wt.exe` and Windows quoting of `"` and `;`. The file holds exactly the env JSON that spec R4 describes.
3. **`--plugin-dir <plugin root>` is added to every launch** (Task 4.1), so tab sessions load the roster MCP server and hooks while the plugin is loaded for development. Verify in 7.2 that this does not double-load if the plugin is later installed from a marketplace.
4. **Plugin MCP servers inherit the `claude` process environment.** The docs do not say so explicitly. The spike's `--mcp-config` server tests the same path. Fallback: an explicit `env` block in `.mcp.json` using `${MM_SESSION_ID:-}` expansion.
5. **Defaults the spec does not set:** idle stop time is 120 minutes; an architect is stale after 30 minutes without a check-in; spend days are UTC; the `main` workstream defaults to branch `main`; the front desk's session name is `mm-front-desk`.
6. **Front-desk identity:** the front desk is the user's own window, not launched by Multi-Manager, so it has no `MM_SESSION_ID`. `start_front_desk` registers it in-process and reuses the single front-desk row. Its hooks stay no-ops, so it recovers lost nudges through `status` and `list_items` (R5 limits hooks to `MM_SESSION_ID` sessions).
7. **Answers go back to the raiser** (Task 3.5). `answer_item` readdresses the item to the session that raised it and marks it unseen. This is how the architect's Stop hook picks up a lost nudge.
8. **Stop safety** (Task 4.4). A tree is killed only if `~/.claude/sessions/<pid>.json` names the session **and** `tasklist` reports `claude.exe` for that pid. Otherwise the session is only marked stopped.
9. **Package versions** (Task 2.1) were current on npm on 2026-10-21. TypeScript is pinned to 6.0.3, because typescript-eslint 8.72 needs `<6.1.0`. TypeScript 6 defaults `types` to `[]`, which is why tsconfig sets `"types": ["node"]`. The MCP SDK 1.32 `registerTool` API and zod 4 compatibility were not compiled during planning.
10. **Spec AC1 wording:** it still says "all four R0 steps". This plan treats that as all eight revised steps.
11. **Developer sessions:** `launch_developer` and `stop_developer` are added beyond R3's tool list. R4 says full-session developers are "launched the same way by their architect", and an architect cannot hand-build the `--settings` file reliably.

## Discovered Work
<!-- Add items here during execution if scope expansion is needed -->
