# R0 spike: tab launch and messaging

Date: 2026-10-21
Machine: Windows 11, Claude Code 2.1.306, Node v25.5.0
Run by: main session (front desk role) + user

| # | Step (spec R0) | Result | Evidence |
|---|---|---|---|
| 1 | Fragment installs, "Multi-Manager" profile picked up | PASS | Copied fragment, then touched Terminal's `settings.json` mtime; within 3 s the profile GUID `{d5a290e8-…}` appeared in `state.json` and `settings.json`. No Terminal restart needed. |
| 2 | Tab opens in `multi-manager` window, Claude in the right folder; args intact | PASS (after fix) | `CommandLine` kept every path with spaces intact. **Fix 1:** first launch used `execFile(..., { windowsHide: true })`, which hid the whole new Terminal window. wt.exe must be launched without `windowsHide`. Parent process of `claude.exe` is `WindowsTerminal.exe`. |
| 3 | Listed in front desk `ListAgents` under `-n` name | PASS (after fix) | Listed as `mm-spike-main [856bee]`. **Fix 2:** the tab inherits the launcher's environment; with `CLAUDE_CODE_CHILD_SESSION=1` (and other `CLAUDECODE` / `CLAUDE_CODE_*` / `CLAUDE_PID` vars from the calling session) Claude Code never writes `~/.claude/sessions/<pid>.json` and never registers for messaging. Stripping them fixes it. Proven by three failing variants (with/without `-n`, direct vs via pwsh) and one passing run with the stripped env. |
| 4 | `SendMessage` round trip, and tab → front desk nudge | PASS | `to: "mm-spike-main"`. Reply `PONG HERON` and nudge `check roster item #1` arrived pushed into the front desk's conversation (`from-name="mm-spike-main" from-mode="bypass"`), no polling. |
| 5 | User types in the tab; messaging still works after | PASS | User typed "Say hello in one word." and it answered; then `ping 2` → `PONG ping 2`. |
| 6 | `MM_*` from `--settings` env visible to hook and MCP server | PASS | `spike-hook-env.json` and `spike-mcp-env.json` both contain MM_ROLE=architect, MM_SESSION_ID=9001, MM_PARENT_ID=9000, MM_ROSTER_DB, MM_VOICE=off. |
| 7 | `taskkill /PID <pid> /T /F` closes the tab completely | PASS | User confirmed the tab vanished with no exit text. **Stale session file left: yes** — `20464.json` remains after the kill, so the stop path must not trust the session file alone (runner double-checks `tasklist` image name). |
| 8 | Reliable pid lookup | PASS | Session file `name` equals the `-n` value, `nameSource: "user"`, found after `waitedMs: 1566`. |

## Notes for implementation

- **Launcher environment:** strip `CLAUDECODE`, `CLAUDE_CODE_*` (keep `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) and `CLAUDE_PID` before running wt.exe; never pass `windowsHide` to wt.exe. Implemented as `launchEnv()` / `hidesWindow()` in `src/launch/runner.ts`.
- **A Terminal window keeps the environment it was created with.** A `multi-manager` window first opened with a polluted environment keeps passing it to new tabs; it must be closed (all its tabs stopped) before launching cleanly.
- **Folder trust:** a folder Claude Code has never trusted shows the trust prompt in the new tab, and the session does not start until the user accepts. Folders only ever opened with `--dangerously-skip-permissions` have never been trusted (that flag skips the dialog), including this repo. Not pre-trusted automatically.
- **Resource use:** every launched session starts its own copy of each user-level MCP server, including `code-review-graph serve` (3 processes per session). Candidate fix: launch with `--strict-mcp-config` plus an explicit server list. Needs a user decision because architects need a browser tool for click-throughs.
- Front-desk addressing: the main session's ListAgents name is derived (`multi-manager-ac`); the tab replies by copying the `from` attribute, so the front desk's name need not be known in advance.

## Decision

GO. All eight steps pass with the two launcher fixes above.
