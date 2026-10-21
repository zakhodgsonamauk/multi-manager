# Track: Core (Stage 1) — Specification

Track ID: `core_20261021`
Type: feature
Source design: `conductor/designs/2026-10-21-multi-manager-design.md` (Build order, stage 1)

## Goal

At the end of this track the user can open one Claude Code window as the **front desk**, register
projects, and give a goal for a project. The front desk launches an **architect** session in its own terminal tab
in that project's folder, hands it the goal, and the architect raises a plan sign-off back to the
user through the roster. The user can ask the front desk "what's going on?" and get an answer from the
roster, open any architect directly, and have the front desk stop architects. This is the minimum
needed to start using Multi-Manager for real.

## Requirements

### R0. Launch-and-message spike (go/no-go gate)

User decision (2026-10-21): sessions are **not headless or background by default**. Every
Multi-Manager session runs as a normal interactive `claude` in its own visible Windows Terminal tab,
until Multi-Manager has its own reliable front end. A finished or stopped session must close
completely: the tab disappears rather than showing "process exited with code N".

Before building anything else, prove by hand on this Windows machine that:

1. A Windows Terminal fragment defining a "Multi-Manager" profile with `"closeOnExit": "always"`
   installs and is picked up.
2. A tab launched as the front desk would (R4 command) opens in the `multi-manager` window and
   starts Claude Code in the right folder.
3. It appears in the front desk's `ListAgents` output under its `-n` name.
4. The front desk can `SendMessage` to it and receive its reply.
5. The user can type in the tab directly, and messaging still works afterwards.
6. The `MM_*` variables passed via `--settings` `env` are visible to that session's hooks and MCP
   servers.
7. Killing the session's process tree (`taskkill /PID <pid> /T /F`) closes the tab completely.
8. A reliable way to find that session's process id is identified (for example
   `~/.claude/sessions/<pid>.json` matched by name).

Record results in `conductor/tracks/core_20261021/spike.md`. If any step fails, stop and report
before continuing.

### R1. Plugin skeleton

A Claude Code plugin named `multi-manager` at the repository root:

- `.claude-plugin/plugin.json` (name, version, description).
- `.mcp.json` registering the roster MCP server.
- Role briefings for front desk, architect and developer.
- User commands: start the front desk, add a project (with workstreams), show status, start an
  architect, stop an architect.
- Hooks that keep sessions in touch with the roster (see R5).

Loadable for development with `claude --plugin-dir <repo>`.

### R2. Roster store

A shared SQLite database (Node's built-in `node:sqlite`) at `~/.claude/multi-manager/roster.db`,
overridable with the `MM_ROSTER_DB` environment variable (used by tests). Safe for concurrent use by
several processes (WAL mode, busy timeout). Records:

- **Projects:** name (unique), folder, permission mode (default `dangerously-skip-permissions`),
  approval rules (free text; default "User signs off on the high-level plan and the high-level
  testing approach: unit tests, end-to-end tests, and the architect's own browser click-through of
  every user-facing change to judge UI design and flow"), idle stop time in minutes, daily budget
  (USD, optional).
- **Workstreams:** per project, name and branch. Every project has a `main` workstream by default.
- **Sessions:** role (`front-desk` | `architect` | `developer`), parent session, project,
  workstream, session name (`-n`), process id, folder, state (`running` |
  `stopped`), last check-in time.
- **Goals:** workstream, text, state (`new` | `planning` | `awaiting-signoff` | `in-progress` |
  `done` | `cancelled`), budget (USD, optional), timestamps.
- **Items** (escalations and notes): goal, raising session, kind (`signoff` | `question` |
  `blocked` | `done` | `info`), body, state (`open` | `answered` | `closed`), the user's answer
  **verbatim**, who it is addressed to, whether the addressee has seen it, timestamps.
- **Claims:** file path (or heavy-job name) within a project, holding session, time. A second claim
  on a held path is refused and names the holder.
- **Spend:** session, goal, USD amount, time. Over-budget (goal or project daily) raises an
  `info`/`blocked` item to the front desk.

### R3. Roster MCP server

A stdio MCP server exposing the roster as tools to every Multi-Manager session. It identifies the
calling session from environment variables set at launch (`MM_SESSION_ID`, `MM_ROLE`). Tools cover:
add/list projects and workstreams; register session, check in, list the session tree; create and
update goals; raise, answer, list and mark-seen items; claim and release; report spend; a status
summary (per project: workstreams, architects and their staleness, active goals, open items, spend
today); launch architect; stop architect.

### R4. Launching and stopping architects

- **Launch:** given project and workstream, if no running architect exists for it, run
  `wt.exe -w multi-manager new-tab --profile "Multi-Manager" --title mm-<project>-<workstream>
  -d <project folder> claude -n mm-<project>-<workstream> --dangerously-skip-permissions
  --append-system-prompt-file <architect briefing> --settings <json> "<initial prompt>"` (omit
  `--dangerously-skip-permissions` when the project's permission mode says so). The `--settings`
  JSON sets `env`: `MM_ROLE=architect`, `MM_SESSION_ID=<new roster id>`,
  `MM_PARENT_ID=<front desk id>`, `MM_ROSTER_DB`, and `MM_VOICE=off` (honoured by session-voice in
  stage 4). Environment goes through `--settings` because `wt.exe` does not reliably pass the
  caller's environment into new tabs. Store the session's process id once found (method from the
  spike). The initial prompt names the goal's roster item.
- **Stop:** kill the session's whole process tree (`taskkill /PID <pid> /T /F`); the tab closes
  because the Multi-Manager profile has `closeOnExit: always`. Mark the session `stopped`.
- Launching an architect for a workstream that already has a running one returns the existing one
  instead.
- **Permission modes must match.** Claude Code holds cross-session messages for the user's approval
  when sender and receiver run in different permission modes. The front desk therefore also runs
  with `--dangerously-skip-permissions`; a project that overrides the permission mode gets a
  warning that messages to and from it will need manual approval.
- Developers that are full sessions (not helper agents) are launched the same way by their
  architect.

### R5. Keeping in touch (hooks)

Plugin hooks, active only when `MM_SESSION_ID` is set:

- **SessionStart:** check in; add open items addressed to this session to the context.
- **Stop:** check in; if there are unseen items addressed to this session, block the stop once with
  a reason listing them and mark them seen (so a lost nudge is recovered, without looping).

### R6. Role briefings

- **Front desk:** route goals to the right architect (launch if needed); fan cross-cutting goals
  out to each relevant architect and gather replies separately; answer status from the roster
  without interrupting architects; quote architects verbatim; record the user's sign-offs and
  answers verbatim via the roster, then nudge the architect with `SendMessage` ("check roster item
  #N"); show waiting items first on start.
- **Architect:** owns one project workstream; keeps a plan and progress log in the project
  (`conductor/` format); raises sign-offs per the project's approval rules (default: plan and
  testing approach); farms large planning work out to research/planning helpers or sessions;
  chooses developer type per task (helper agent in its own worktree, or a full session in its own tab for
  long jobs) and registers them; claims shared files before editing; reports spend; records
  outcomes of direct conversations with the user in its progress log and the roster; checks in at
  milestones; nudges the front desk after raising items.
- **Developer:** works only on its assigned slice in its own worktree; reports to its architect
  through the roster; never merges or pushes beyond its branch.

### R7. Project check command

Replace the placeholder `.claude/check.cmd` with real checks for the chosen language (type check,
lint, tests), after the user approves installing the tools.

## Acceptance criteria

1. `spike.md` records a pass on all eight R0 steps (or the track halts with a written failure).
2. `npm run check` (via `.claude/check.cmd`) passes: type check, lint, and all automated tests.
3. Automated tests cover the roster store: project/workstream creation with defaults; session
   tree; goal state changes; item raise → answer stores the answer verbatim; unseen-item marking;
   claim refusal naming the holder; spend over budget raising an item; status summary contents.
   Tests use a temporary database via `MM_ROSTER_DB`.
4. Automated tests cover the launch command builder (exact arguments, with and without skipped
   permissions, environment variables) without actually launching Claude.
5. Automated tests cover the Stop hook: blocks once when unseen items exist, does not block the
   second time, does nothing when `MM_SESSION_ID` is unset.
6. Manual end-to-end check, recorded in `conductor/tracks/core_20261021/e2e.md`: with the plugin
   loaded via `--plugin-dir`, from a front-desk session: add a throwaway project, give it a goal,
   see an architect open in its own tab, receive a plan sign-off item, answer it (stored
   verbatim), see the architect continue, ask for status, type to the architect directly in its
   tab, stop it from the front desk and see its tab close completely.

## Out of scope (later stages)

Architect plan loop / SupaConductor integration and its Windows locking fix, crash recovery and
restart-after-reboot, loop detection (stage 2); resource watchdog (stage 3); voice changes (stage 4);
status web page (stage 5); phone access (stage 6); more than one front desk; cross-machine sessions.

## Technical notes

- Platform: native Windows 11 first; Node 25 (built-in TypeScript type stripping and `node:sqlite`
  are available); Claude Code 2.1.306.
- Language: TypeScript run directly by Node (erasable syntax only — no enums, namespaces or
  parameter properties), checked with `tsc --noEmit`. Tests with `node --test`.
- MCP: `@modelcontextprotocol/sdk` with `zod` schemas.
- Keep the store a plain module with no MCP dependency so hooks, the MCP server and tests share it.
- Process launching goes through one small module that builds the command (pure, testable) and one
  that runs it.
- Relevant CLI facts verified on 2026-10-21: `-n/--name`, `--append-system-prompt-file`,
  `--settings`, `--plugin-dir`, `--session-id`, `--dangerously-skip-permissions` exist. Windows
  Terminal is installed (`wt.exe` in WindowsApps); the user's settings have no `closeOnExit`, so the
  default leaves tabs open after a forced kill — hence the dedicated profile.
- Reference implementations on this machine: `claude-context-sync` (session discovery, hook-based
  delivery), `multi-model-ai` (Agent SDK worker launching).
