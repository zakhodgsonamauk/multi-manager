# Multi-Manager — Design

Date: 2026-10-21
Status: Approved in brainstorming
Builds on: `2026-10-21-multi-manager-vision.md`, `2026-10-21-prior-art-research.md`

## Purpose

Let one person give high-level direction to several software projects at once, from a single
Claude Code conversation. Multi-Manager is a Claude Code plugin that organises Claude Code
instances into three tiers:

```
User ──► Front desk (1) ──► Architects (X, one per project workstream) ──► Developers (Y each)
   └───────────── (direct conversation with any architect, when wanted) ─────┘
```

## Decisions from brainstorming

| Topic | Decision |
|---|---|
| What the user sends the front desk | All of: per-project goals, cross-cutting changes across projects, status and triage, answers to escalations. Nitty-gritty detail may go straight to an architect. |
| How architects exist | The front desk launches and stops them. Each runs as a normal interactive Claude Code session in its own visible Windows Terminal tab (window `multi-manager`); the user switches to the tab to talk directly. |
| Headless sessions | Not by default. No Multi-Manager session runs headless or as a hidden background session until Multi-Manager has its own reliable front end. |
| Closing sessions | A finished or stopped session closes completely — the tab disappears. Tabs use a dedicated "Multi-Manager" Windows Terminal profile with `closeOnExit: always`, and stopping kills the session's whole process tree. |
| What a developer is | The architect decides per task: a helper agent in its own temporary copy of the project (git worktree) for small slices, or a full session in its own tab for long jobs. |
| Large feature planning | The architect should farm large planning work out to separate research/planning helper agents or sessions, then merge the results into its own plan. |
| Approvals | No hard-coded rules; set per user and per project via initial instructions. Default: the user signs off on (a) the high-level plan and (b) the high-level testing approach — unit tests, end-to-end tests, and the architect clicking through every user-facing change in a browser to judge UI design and flow independently. |
| Status channels | Front desk chat, a live **front desk pane** drawn inside the front desk session (decided 2026-10-21, replacing the separate status web page), spoken alerts (via session-voice), and phone access (via Remote Control, which shows the same pane). Built in stages, chat first. |
| Two architects on one project | Each owns a named workstream with its own branch; shared files are claimed before editing, otherwise the owner is messaged. |
| Permissions | Unless a project specifies otherwise, every Claude Code instance — including the front desk — is launched with `--dangerously-skip-permissions`. Claude Code holds cross-session messages for manual approval when sender and receiver run in different permission modes, so a project that overrides this gets a warning. |
| Testing of the add-on | No up-front test programme; the system is proven by real use. Exception: an automated check of the watchdog's process-stopping logic, since a bug there could kill processes we do not own. |
| Platform | Native Windows 11 first. No tmux, no WSL dependency. |
| Foundation | Approach A: a new plugin built on Claude Code's native cross-session messaging, with sessions in Windows Terminal tabs (chosen over extending claude-context-sync or adopting Gas Town). |

### Risk accepted: skipped permissions

With `--dangerously-skip-permissions`, nothing technically stops any session from deleting files,
pushing branches or running arbitrary commands. Approval points are instructions the agents follow,
not enforced locks. Mitigation: developers work in temporary copies of the project; anything leaving
a branch is subject to the project's approval rules.

## Components

### 1. The plugin (`multi-manager`)

- Role briefings for front desk, architect and developer (skills/agent definitions).
- Commands: add a project, show status, start/stop an architect, mute voice.

### 2. The roster

A small local tool connection (MCP server, Node) loaded by every Multi-Manager session. All
sessions share one database file under `~/.claude/multi-manager/` (Node's built-in SQLite). It
records:

- Projects: folder, workstreams, approval rules, permission mode, budgets.
- The tree: which front desk owns which architects, which architect owns which developers, with
  each session's ID, process ID, role, folder and last check-in time.
- Goals and their state.
- Escalations and sign-offs. The user's answers are stored verbatim.
- File claims (for shared files across workstreams) and heavy-job claims (see watchdog).
- Status and spend per goal, per project, per day.

The front desk pane, spoken alerts and phone access all read from this same record.

### 3. Front desk

The user's normal Claude Code window, with the front-desk briefing. It:

- Routes goals to the right architect, launching one if none exists for that workstream.
- Fans cross-cutting goals out to each relevant architect and collects each reply separately.
- Answers status questions from the roster without interrupting architects.
- Quotes architects verbatim rather than paraphrasing (avoids the "telephone game" seen in the
  research).
- Is the only session that speaks alerts.
- On start, shows anything waiting in the roster first, and offers to restart architects that are
  missing (e.g. after a reboot).

### 4. Architects

Interactive Claude Code sessions in their own Windows Terminal tab, one per project workstream,
launched in the project folder with the architect briefing, voice muted, and the project's
permission mode. Session settings (role, roster id, parent) are passed through Claude Code's
`--settings` `env` key, because `wt.exe` does not reliably pass the caller's environment into new
tabs. Each:

- Keeps a plan and progress log inside the project in SupaConductor's format. This log is the
  source of truth, so direct conversations between the user and an architect are not lost to the
  front desk.
- Writes a plan and testing approach for each goal and raises sign-off escalations per the
  project's approval rules.
- Farms out large planning work to research/planning helpers or sessions.
- Chooses developer type per task and manages them (time limit, one retry, then escalate).
- Tests: unit, end-to-end, and its own browser click-through of user-facing changes. Reports done
  with evidence.
- At each milestone, checks whether it is progressing or looping; after a set number of failed
  attempts, escalates instead of continuing.
- Stays alive between goals; the front desk stops it after a configurable idle time.

### 5. Developers

Either helper agents spawned by the architect (each in its own git worktree) or full sessions in
their own tab for long jobs, launched the same way as architects. Both are registered in the roster under their architect.

### 6. Messaging: two channels

- Conversation uses Claude Code's built-in cross-session messaging (`SendMessage`/`ListAgents`,
  named pipes on Windows).
- Anything that must persist goes in the roster. Built-in messages are only nudges that point at a
  roster item ("check item #12"), because they can be dropped (inbound queue of 50) and do not count
  as the user's consent. Sessions re-check the roster whenever they go idle or start.

### 7. Voice

The session-voice Stop hook currently fires for every Claude Code instance, which becomes confusing
with many sessions. Changes needed in session-voice:

- A launch setting (environment variable) to mute a session; sessions launched by Multi-Manager start muted.
- A `/voice off` (and on) command inside a session.
- A roster tool to mute/unmute any session.

The front desk speaks roster events that need the user ("Project A needs a sign-off").

### 8. Resource watchdog

Any session may start processes or run heavy plugins (for example, building the code-review-graph
code map). The watchdog runs on a timer and:

- Lists every process descended from each session we launched, with CPU and memory use.
- **Orphans:** processes still running after their launching session has ended. If they came from
  one of our sessions, they are stopped after a grace period and logged. Processes we did not start
  are never touched.
- **Hogs:** anything over a CPU/memory threshold for several minutes is reported to the front desk
  with the responsible session and plugin. The user decides whether to stop it.
- **Heavy jobs** are claimed in the roster before starting so only one runs machine-wide at a
  time.
- Adds a resources line to the front desk's status answer.

### 9. Front desk pane

Decided 2026-10-21. The user-facing UI stays inside Claude Code: the plugin ships a **mod** (Claude
Code's plugin UI layer: `hooks/hooks.json` `modules`, a `register` module drawing through
`ui.render`). The engine draws the same tree on every surface the front desk runs on — terminal,
desktop app, VS Code, and mobile through Remote Control — so one UI covers all of them. It is only
active in the front desk session.

- **Pane beside the chat** (`$.ui.open`, opened by a `/multi-manager:pane` command and unasked
  only where the surface docks it as a sidebar): every project and workstream, its architect and
  developers with state (busy / idle / stuck / dead), active goals, waiting sign-offs and
  questions, spend today, resources against caps. Per item: the body quoted verbatim, an answer
  field and send button (desktop/VS Code/terminal), quick-answer buttons where a surface has no
  text input (mobile). Per architect: open its tab, stop. Global: pause / resume.
- **Band above the prompt** and a **status-line entry**: one line — waiting sign-offs, stuck
  sessions, architects busy.
- **Toasts** when something new needs the user.
- Data comes from the roster MCP tools (`status`, `team_health`, `list_items`, `resources`),
  refreshed on a timer. Every write goes through the same tools as the chat (`answer_item` stores the
  user's words verbatim; buttons are the user acting directly, never a relayed approval).
- This pane is the candidate "reliable front end" that must exist before any session may run
  headless.

## Error handling

| Situation | Handling |
|---|---|
| Built-in message lost | Messages are only nudges; the roster holds the content; sessions re-check the roster on idle/start. |
| Architect crashes, or machine reboots | Sessions check in with the roster on a timer. The front desk spots one that has gone quiet and restarts it from its saved conversation (`--resume`); the architect re-reads its progress log. After a reboot the front desk offers to bring all architects back. |
| Developer hangs or fails | Architect applies a time limit, one retry, then escalates. |
| Agent looping | Milestone progress check; after a set number of failed attempts, escalate. |
| Two workstreams need the same file | Claim the file in the roster before editing; if held, message the owner. |
| Spend overrun | Per-goal and per-day budgets in the roster; architects report spend; overrun raises an escalation; the front desk can stop sessions. |
| Front desk closed | Architects keep working; escalations queue in the roster and are shown first when the front desk reopens. No spoken alerts until phone access exists. |
| Orphaned or hogging processes | Resource watchdog (above). |

## Build order

1. **Core:** plugin, the three role briefings, the roster (projects, workstreams, tree, escalations,
   sign-offs, claims, budgets), front desk launching/stopping/messaging architects, chat-only
   status. Usable for real from the end of this stage.
2. **Architect engine:** SupaConductor-style plan loop with progress log, delegated large-scale
   planning, per-task developer choice, crash recovery and loop detection. Includes replacing
   SupaConductor's `fcntl` file locking so it works on Windows.
3. **Resource watchdog.**
4. **Voice:** session-voice mute switch (launch setting, `/voice off`, roster tool); front desk
   speaks roster alerts.
5. **Front desk pane** (replaces the separate live status page): pane, band, status line and
   toasts drawn by a mod in the plugin.
6. **Phone access** to the front desk through Remote Control (the pane comes with it).

Stages 3–6 can be done in any order. Progress as of 2026-10-21: stage 1 done; watchdog (stage 3)
done in the form of kill-on-close sessions, the 30-second monitor, enforced caps and stuck
detection; pause/resume, number allocation and the 10-minute check-in timers added from the
Conflict Command field report; stage 5 (pane) in progress.

## Known unknowns

- Whether a session launched by the front desk in a new Windows Terminal tab is listed and
  messageable by the front desk, receives its settings through `--settings`, and closes its tab
  completely when its process tree is killed. This is the first thing to try in stage 1.
- How to find a tab-launched session's process id reliably (candidate: `~/.claude/sessions/*.json`
  matched by session name).
- Which browser tool architects use for click-throughs (Playwright failed to connect in the
  brainstorming session; webclaw is available).
