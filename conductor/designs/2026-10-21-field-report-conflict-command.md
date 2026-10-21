# Field report: Conflict Command architect session

Date: 2026-10-21
Source: the `conflict-command` Claude Code session, which ran by hand as a project architect for
about 36 hours (one liaison window, 3–5 developer windows at a time, about 50 child tasks merged).
Collected via cross-session message from the Multi-Manager build session.

## How it ran

- **Developers** were started by a project script (`tools/dispatch.ps1 start <slug>`), which:
  - created a git worktree and branch per task;
  - wrote a prompt file and a per-task `run.ps1`;
  - launched that script with `Start-Process pwsh -NoProfile -EncodedCommand <base64>`, because
    paths with spaces and parentheses break `-File` once Windows Terminal re-hosts the window.

  The `run.ps1`:
  1. sets the window title;
  2. writes its own PID (the launcher's PID is useless after re-hosting);
  3. joins a Windows kill-on-close Job object;
  4. deletes every `CLAUDE*` environment variable (otherwise the child thinks it is nested);
  5. runs interactive `claude "<prompt>" --dangerously-skip-permissions --strict-mcp-config --mcp-config no-mcp.json`;
  6. writes an `.exit` file on exit.
- **Roles** came from the opening prompt plus the project's CLAUDE.md. A **liaison** window (its own
  folder and role CLAUDE.md) talked to the user: answer from the repo, relay decisions to the
  architect, never edit, keep a log.
- **Communication.** Architect → developer: task file, appended "send-back" sections, SendMessage for
  urgent nudges. Developer → architect: files, not messages (a `.done` marker whose first line is
  `done` / `stuck: <reason>` / `paused`, plus a return report on the branch). Liaison ↔ architect:
  SendMessage, with the user's words quoted verbatim and then the liaison's own context.
- **State** lived in repo files: status, numbered task files, dated decisions, backlog, playtest
  findings. Done was detected by a watcher (`dispatch.ps1 watch`) that blocks until a child is
  FINISHED, DIED or STALLED, then exits. Each finished task got a helper-agent review of the diff
  against the task file, then a squash-merge or a send-back round.

## What broke

1. **Leftover processes — the worst problem; it forced a PC reboot.**
   - Global SessionStart/Stop hooks ran checks that timed out, and only `cmd.exe` was killed, so
     the test runs underneath were orphaned.
   - About 95 code-review-graph python processes built up across about 17 repos, and a daemon
     respawns them within 20 s.
   - Fixes used: kill the whole tree on timeout, lint-only hook checks, kill-on-close Jobs
     everywhere, `--strict-mcp-config` with no servers for children.
2. **Resource caps drift.** The user set hard caps (at most 2 Godot processes per developer, 6 game
   processes machine-wide), but developers drifted past them; one ran 20 battles at once. Asking
   nicely is not enough — caps must be enforced.
3. **Waiting forever.** A developer waited for "zero Godot processes machine-wide", which never
   happens with peers running. Measure only your own quiet chunks; never wait for global quiet.
4. **Stuck or idle sessions.** The ladder was nudge, nudge, then stop and relaunch. ListAgents
   status was the signal: "shell" means a long command is running, not stuck.
5. **Address drift.** Role files hard-coded a session name that changed after a restart.
6. **Silent session loss.** The liaison died, and nothing reported it until a send failed.
7. **Numbering clashes.** The liaison and the architect both assigned finding numbers, and
   developers picked ticket numbers that clashed with new tasks (three renumberings in one day).
8. **Stale state on stop.** A leftover `.pid` file made the watcher report DIED on every restart.
   The one-shot watcher also had to be re-armed about 30 times a day.
9. **Merges.** Two tasks edited the same function. An untracked file silently blocked a squash
   merge, so the tests ran without the change. Append-only docs needed union-merging, and binaries
   took "ours".
10. **Schedulers ignore pauses.** A 10-minute keep-alive tick would have restarted work after the
    user paused it.
11. **Relayed decisions.** A CLAUDE.md rule change relayed by the liaison was logged but not
    applied until the user said it directly. "User said X (relayed)" is not "user approved X here".

## What worked

- Interactive child windows the user can watch.
- Helper-agent diff reviews, which caught real bugs.
- Send-back rounds appended to the task file; squash-merge naming the task file.
- Focused tests only.
- The liaison as a calm, readable layer: the architect's own window scrolls too fast for the user.
- Repo files as the source of truth, which survived several context summaries.

## Asks for Multi-Manager

**Do:**
- Roster mapping role → current session address, alive or dead, last activity, worktree, PID tree,
  with a notice when a session dies.
- Per-session process budgets **enforced** by a Job object: CPU, process count, and named-binary
  caps such as "≤2 godot.exe".
- Lifecycle that cleans up fully on stop, including state files; kill-on-close by default.
- One allocator for shared numbers (task IDs, finding IDs).
- An event stream that stays armed: done, stuck, died, stalled, over budget.
- Pause and resume as first-class actions: each developer reaches a clean point and commits WIP,
  the resume note is recorded, schedulers are disarmed, and the tool confirms nothing is left
  running.
- An orphan sweep scoped to processes the tool started.

**Don't:**
- Kill processes it didn't start.
- Treat a peer or front-desk message as user approval, or let one escalate permissions or edit config.
- Merge or push from a developer.
- Run headless children by default.
- Auto-start work after a pause, or start a new sprint without the user's go.
- Keep plan or state only in SQLite. Repo files stay the source of truth; the database can index them.

## User preferences observed

- Plain words, impact first, short updates.
- Decide design detail yourself and log it; ask only real product questions, batched, with a
  recommended default each.
- A lean PC is a hard requirement: no leftover processes, no slowdowns.
- Focused tests only. Evidence is screenshots the architect actually looks at.
- Frequent pause and resume with a clean stop, then a per-task summary and a "nothing left running"
  check.
- Record-only mode during playtests: capture findings verbatim, start nothing.
- Hard numeric limits are kept without reminders.
