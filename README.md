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

## Use

Start the front desk. It must use the same permission mode as the architects, or cross-session
messages are held for approval:

    claude -n mm-front-desk --plugin-dir "<path to this repo>" --dangerously-skip-permissions

Then run `/multi-manager:front-desk`. Other commands: `/multi-manager:add-project`, `/multi-manager:status`,
`/multi-manager:start-architect`, `/multi-manager:stop-architect`. Architects open as tabs in the
`multi-manager` Windows Terminal window; switch to a tab to talk to one directly. Stopping an architect
closes its tab.

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
