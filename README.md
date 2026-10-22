# Multi-Manager

A Claude Code plugin (in design) for giving high-level direction to several software projects at
once from a single Claude Code conversation.

One user-facing **front desk** session launches and directs **architect** sessions (one per project
workstream), and each architect directs its own **developer** agents. A shared local roster tracks
projects, who reports to whom, escalations, sign-offs, spend and resource use.

Status: stage 1 (core) — front desk, roster, architects in Windows Terminal tabs. Windows 11 first.

## Setup (development)

Requires Node 25+, Claude Code 2.1.306+, Windows Terminal.

    npm install
    node scripts/install-terminal-profile.ts   # Terminal picks it up within seconds; restart it if not
    .claude\check.cmd                          # type check, lint, tests

`/multi-manager:front-desk` also installs the Terminal profile, so the second step is optional.

The roster MCP server is declared inline in `.claude-plugin/plugin.json` (`mcpServers`), so it only loads
as part of the plugin. There is deliberately no `.mcp.json` at the repo root: Claude Code would read one as
a project MCP config in any session opened in this folder, where `${CLAUDE_PLUGIN_ROOT}` is unset.

The front desk pane is a mod (Claude Code's plugin UI layer): `hooks/register.tsx`, named under `modules`
in `hooks/hooks.json` beside the classic SessionStart/Stop hooks, with its state contract in
`types/index.d.ts`. It has its own checks, which need the `claude` CLI:

    npm run check:mod    # tsc against the plugin API, claude plugin validate, mod tests (mod-test/)

`npm run typecheck:mod` reads the API types from `.claude-plugin/types/` (gitignored), which Claude Code
writes there whenever it loads this folder with `--plugin-dir` (the front desk does). `npm run test:mod`
stages the mod alone in a temporary folder and runs `claude plugin test` there, because the kit would
otherwise try to run the Node suites in `test/` too.

## Use

Double-click `front-desk.bat` in this repo. A pop-up asks which team to open, and remembers your last
choice:

- **My main team (no folder)**: the shared roster on this PC (`~/.claude/multi-manager/roster.db`),
  opened in this repo's folder. This is the team the old command line opened.
- **A cluster folder**: browse for it, or paste the path. Each cluster folder is a separate team: its
  front desk, and every architect and developer that front desk launches, keep their roster in
  `<folder>\.multi-manager\roster.db` (with a `.gitignore`, so a git repo does not see it). Two folders
  never see each other's projects, sessions or sign-offs, nor the main team's.

Tick "Reachable from my phone" for Remote Control. OK opens the front desk in its own Windows Terminal
window; Cancel opens nothing. It needs Node and PowerShell 7 (`pwsh`), and says so in a message box if
either is missing or the launch fails.

A cluster folder inside Dropbox (or any synced folder) syncs a live database: use it from one PC only,
or pick a folder outside sync.

The front desk tab runs with `--dangerously-skip-permissions`, the same permission mode as the
architects (otherwise cross-session messages are held for approval), and with the full-screen layout so
the pane docks beside the chat. It already runs `/multi-manager:front-desk`. Other commands: `/multi-manager:pane`, `/multi-manager:add-project`, `/multi-manager:status`,
`/multi-manager:start-architect`, `/multi-manager:stop-architect`. Architects open as tabs in the
`multi-manager` Windows Terminal window; switch to a tab to talk to one directly. Stopping an architect
closes its tab.

Architects run a light workflow with `/multi-manager:plan-goal`, `/multi-manager:dispatch`,
`/multi-manager:review-return` and `/multi-manager:wrap-goal`. Plans and state live in the project
(`docs/multi-manager/`: status, numbered task files, decisions, progress), from `templates/architect/`.

**Front desk pane:** once the session is the front desk, a pane beside the chat shows every project and
workstream, each architect (busy, idle, stuck or dead, minutes quiet, its developers, processes against
its limit), active goals, spend today, and everything waiting for you, each quoted word for word with a
field to type your answer (Approve / Reject buttons on the phone app). Stop an architect or pause and
resume everything from there. It opens by itself where Claude Code docks panes beside the transcript
(fullscreen terminal); elsewhere run `/multi-manager:pane`. A one-line summary sits above the prompt and
in the status line, and a toast appears when something new waits for you or a session gets stuck. It
refreshes every 15 seconds. Answers typed there are stored exactly as typed, and the pane passes the
"check roster item" message to the architect itself (or asks the front desk to, if it cannot).

**Folder trust:** the first time an architect opens in a project folder Claude Code has never
trusted, the tab shows the trust prompt and the session does not start until you accept it there.
Folders only ever opened with `--dangerously-skip-permissions` count as never trusted.

**Terminal window environment:** a `multi-manager` window keeps the environment it was created with.
If one was first opened from a polluted environment (tabs not appearing in the front desk's agent
list), stop all its tabs and close it before launching again.

Everything Multi-Manager records (projects, sessions, sign-offs, limits) lives only on your own PC: in
the cluster folder's `.multi-manager\roster.db` for a cluster front desk, otherwise (the main team) in
`~/.claude/multi-manager/roster.db` (override with `MM_ROSTER_DB`; the pop-up's main team always uses this default). Nothing personal is stored in this repo.
`node scripts/dump-roster.ts` prints it.

