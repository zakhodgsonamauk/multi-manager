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

Start the front desk. It must use the same permission mode as the architects, or cross-session
messages are held for approval:

    claude -n mm-front-desk --plugin-dir "<path to this repo>" --dangerously-skip-permissions

Then run `/multi-manager:front-desk`. Other commands: `/multi-manager:pane`, `/multi-manager:add-project`, `/multi-manager:status`,
`/multi-manager:start-architect`, `/multi-manager:stop-architect`. Architects open as tabs in the
`multi-manager` Windows Terminal window; switch to a tab to talk to one directly. Stopping an architect
closes its tab.

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

The roster lives at `~/.claude/multi-manager/roster.db` (override with `MM_ROSTER_DB`).
`node scripts/dump-roster.ts` prints it.

- Vision: [`conductor/designs/2026-10-21-multi-manager-vision.md`](conductor/designs/2026-10-21-multi-manager-vision.md)
- Prior-art research: [`conductor/designs/2026-10-21-prior-art-research.md`](conductor/designs/2026-10-21-prior-art-research.md)
- Design: [`conductor/designs/2026-10-21-multi-manager-design.md`](conductor/designs/2026-10-21-multi-manager-design.md)
