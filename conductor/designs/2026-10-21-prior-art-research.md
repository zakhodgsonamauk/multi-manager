# Multi-Manager — Prior-Art Research

Date: 2026-10-21
Companion to: `2026-10-21-multi-manager-vision.md`

Four research passes: Anthropic first-party features, open-source Claude Code orchestrators, the
wider commercial/framework landscape, and tooling already installed on this machine. Star counts and
dates were taken on 2026-10-21. Items marked *(unverified)* could not be confirmed from a primary
source.

## Headline

Nobody ships the exact shape we want: one user-facing instance, a persistent architect per project
across several repos, and short-lived developers under each architect, running on native Windows.
The closest match is Gas Town (community, three tiers, cross-project, but tmux/WSL for full mode and
one central coordinator rather than an architect per project). Anthropic's own features now cover
most of the low-level plumbing on native Windows, so the add-on is likely to be a thin layer of roles,
a project roster, launching/lifecycle and roll-up status on top of them.

## 1. What Anthropic already ships (Claude Code docs, code.claude.com/docs/en/…)

| Feature | Fits which tier | Key limits | Maturity |
|---|---|---|---|
| Subagents (`sub-agents`) | Architect → developer, inside one session | Nest up to 3 levels by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); max 20 concurrent; results return only to the caller | Stable |
| Agent teams (`agent-teams`) | Architect as team lead over developer teammates | Experimental flag; one team per session; teammates cannot start their own teams; no worktree isolation for teammates; interactive only | Experimental |
| Cross-session messaging (`cross-session-messaging`) — `ListAgents`, `SendMessage`, `/peers` | Front desk ↔ architects; architects ↔ background developers | Same machine over a named pipe (native Windows from v2.1.234); plain text; ~1M chars per message; inbound queue of 50; cross-machine needs Remote Control; cloud sessions cannot reply. A message from another session never counts as the user's approval. | Not labelled |
| Agent view / background sessions (`agent-view`, `claude --bg`, `claude agents --json`) | Launching and watching architects/developers | Background sessions report to the user, not to a parent session | Research preview |
| Remote Control, cloud sessions | Reaching the front desk from phone/browser; remote runners | claude.ai sign-in; cloud sessions cannot see local repos | Not labelled |
| Workflows (`workflows`) | Architect-side fan-out scripts | No filesystem/shell inside the script; no mid-run input | Not labelled |
| Headless `claude -p` and Agent SDK | Programmatic launching of any tier | `--resume`, `--max-budget-usd`, `stream-json`; SDK is self-hosted | `-p` stable |
| Worktrees | One temporary copy of the project per developer | Per repository | Stable |
| Hooks / plugins / MCP | Glue | `SessionStart`, `TeammateIdle`, `TaskCompleted`, `WorktreeCreate` hooks etc. | Varies |

Gaps first-party leaves open:

1. Messaging is peer-to-peer, not supervisory. The front desk cannot pass on the user's consent; an
   explicit approval path is needed.
2. No record of a parent/child tree of top-level sessions, and no documented "session launches
   session" API (running `claude --bg` from a shell is the likely route — *unverified*).
3. Agent teams cannot nest, so they can serve the architect → developer link but not the middle tier.
4. No project roster, per-project permission scope, or cost roll-up across the tree.
5. Several pieces are experimental or research preview; churn risk.

## 2. Open-source Claude Code orchestrators

| Tool | Depth | Cross-project | Communication | Windows | Status | Fit |
|---|---|---|---|---|---|---|
| Gas Town (gastownhall/gastown, Yegge) | 3+ (Mayor → per-rig Witness/Refinery → polecat workers) | Yes | tmux, `gt mail`, Beads ledger, git hooks | CLI only natively; full mode needs WSL | 18.5k★, active | Closest match |
| Tmux-Orchestrator (Jedward23) | 3 (Orchestrator → PMs → Engineers) | Yes | tmux send-keys | No | Stale since 2025-07 | Design reference only |
| AWS CLI Agent Orchestrator | 2 | Yes (example) | tmux, local server, MCP | No | 1.5k★, active | Partial |
| claude-swarm (parruda) | Any-depth tree; each child exposed to its parent as an MCP server | Yes | MCP (blocking calls) | ? | Effectively dead | Clean idea, suits one-off tasks |
| ruflo / Claude Flow | "Hive-mind" topologies | Federation | MCP + vector memory | Yes | 78k★, active | Mostly in-process agents *(unverified)* |
| oh-my-claudecode | 2 | Sibling repos only | Agent teams, tmux | Via psmux | 40k★, active | Partial |
| mcp_agent_mail | Message bus only | Yes | MCP over HTTP + SQLite | ? | Python version unmaintained | Building block |
| multiclaude, Overstory | 2 | No / limited | tmux, SQLite mail | ? | Slowing / archived | Low |
| claude-squad, ccmanager, agent-deck, ntm, Nimbalyst/Crystal, Conductor, Sculptor, Superset, Emdash, Happy | Flat (human dashboards; agents do not talk to each other) | Some | — | Mixed | Mixed | Dashboard ideas only |
| Vibe Kanban, uzi, claude-code-mcp | — | — | — | — | Shutting down / dead / archived | — |

## 3. Wider landscape

Commercial products are almost all two-tier: the human manages a fleet of agents through a
dashboard grouped by project. Examples: GitHub Agent HQ / Mission Control, OpenAI Codex app,
Cursor 3 Agents Window, Google Antigravity Agent Manager, Warp Oz, Devin Desktop. The clearest
architect → developer products are Devin "manages Devins", Factory Missions
(orchestrator/workers/validators) and Augment Intent (coordinator → specialists in worktrees →
verifier). None has a persistent architect per project under a single user-facing agent.

Frameworks: LangGraph supervisors (supports supervisors of supervisors; fixed a "telephone game"
problem by forwarding worker replies verbatim), CrewAI hierarchical process (many reports of the
manager failing to delegate), Magentic-One (orchestrator keeps a Task Ledger and Progress Ledger and
replans when stuck), OpenAI Agents SDK (nested handoffs reportedly break at three levels; use
agents-as-tools instead).

Protocols: MCP is the common glue today. Google A2A suits long-lived peers with task state (front
desk ↔ architect); community bridges a2acode and a2abridge wrap Claude Code as an A2A peer. Zed's
ACP suits driving coding-agent subprocesses (architect ↔ developer).

## 4. Already on this machine

- **orchestrator-supaconductor** (user's own plugin): plan → evaluate → execute → evaluate → fix
  loop inside one session, up to 5 parallel workers, file-based message bus under
  `conductor/tracks/{track}/.message-bus/`. Single-project. Lock code uses `fcntl` (not available
  on Windows). Natural candidate for what each architect runs.
- **claude-context-sync** (sibling project, fork of `ybin4548/claude-context-sync`): reads
  `~/.claude/sessions/*.json` to find live sessions across all projects, tracks touched files, file
  inboxes under `~/.claude/context-sync/messages/`, delivered by a SessionStart/UserPromptSubmit
  hook. Cross-project discovery and direct messaging already work; no roles or launching.
- **Native session files** (`~/.claude/sessions/<pid>.json`) carry a named-pipe messaging path,
  name and status; `crossSessionInbound: accept` is set. Agent teams flag is on; 261 team folders
  exist under `~/.claude/teams/`.
- **second-opinion MCP** (`multi-model-ai`): working example of launching headless Claude Code
  sessions via the Agent SDK in any folder, with resume/fork and job tracking on disk.
- **session-voice**: spoken alerts when one of many sessions finishes or needs input.

## 5. Lessons and pitfalls from the evidence

1. Multi-agent setups lose 39–70% on sequential tasks (Google/MIT, arXiv 2512.08296). A central
   coordinator helps contain errors (4.4× vs 17.2× compounding). Developers should get independent,
   parallelisable work.
2. Most failures are system-design failures: unclear specs, agents misaligned with each other, weak
   verification (MAST, arXiv 2503.13657).
3. Each hand-off loses context. Managers without codebase context become over-prescriptive;
   children assume shared state; children do not report up unless built to (Cognition, 2025/2026).
4. Cost: Anthropic's multi-agent research system used ~15× the tokens of a chat. Gas Town users
   report heavy spend.
5. Common mitigations: one temporary copy of the project per developer; pass developer results up
   unedited; a plan + progress record per architect; separate reviewers with no shared context.
6. No study isolates the effect of a third tier *(unverified gap in the literature)*.

## Design implications (to test during brainstorming)

- Keep the front desk thin: a router and summariser that quotes architects rather than paraphrasing.
- Architects are persistent, one per project (or workstream), each with its own plan and progress
  record — possibly running SupaConductor.
- Developers are short-lived, isolated in their own temporary copy of the project, given
  parallelisable slices.
- Build on Claude Code's native session messaging and background sessions rather than tmux.
- What we actually need to build: project roster, roles, launching and lifecycle, approval relay,
  roll-up status and cost.
