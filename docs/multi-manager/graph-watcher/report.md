# code-review-graph on this PC: investigation report

Goal #100 (front desk goal #99). Date: 2026-11-03. Read-only investigation: nothing was changed, stopped, started or uninstalled.

## Short answer

- **It was not the main cause of today's overload.** The PC ran out of memory, not out of process slots. Windows' own low-memory warning at 13:07 named the ComfyUI image generator (57.7 GB) and two local AI model servers (15.6 GB and 4.4 GB) as the biggest users. code-review-graph held about 5.6 GB (about 4% of what was in use) and 83 of the 708 running programs. It added to the pile, but it was not the pile.
- **It is barely used.** In six weeks of saved session logs (2,291 files) there are 30 calls to its tools. All came from financial-portal, tell-me-a-story and RTS-Commander, mostly in sessions you started by hand. One call came from a Multi-Manager developer. Architects, project managers and the front desk have never used it, and multi-manager itself never has.
- **It costs more than it gives.** Every Claude Code session starts its own copy of the tool connection, at about 566 MB each (4.5 GB with 8 sessions open). An always-on watcher process tree also runs for each of 18 folders. The watch list only grows: every folder you open a session in is added and never removed.
- **Data stays on this PC.** It indexes code files only, never documents. The only network call goes to the local Ollama model on 127.0.0.1. One caveat: financial-portal's index (1.47 GB) sits inside the Dropbox folder, so Dropbox uploads it.
- **Recommendation:** switch off the always-on watcher and the automatic "add every folder" start-up step. Keep the tool connection only in the two projects that use it, clear stale data, and move financial-portal's index out of Dropbox. Separately, the real overload risk is ComfyUI plus big local models running at the same time as many sessions.

## 1. What it is and how it got here

- **Package:** `code-review-graph` version 2.3.7, "Local-first knowledge graph for token-efficient code review through MCP and CLI". MIT licence, by Tirth Kanani (upstream repo github.com/tirth8205/code-review-graph, site code-review-graph.com).
- **This install is your own fork.** It is not the public package. pipx installed it as an editable copy of `C:\Users\zak_h\dev\code-review-graph`, which has origin `github.com/zakhodgsonamauk/code-review-graph` and about 12 of your own commits since 29/07 (embeddings, hooks, watcher). The latest is `db2c594` on 2026-10-21, "fix(watch): honour gitignore and skip nested working copies".
- **It runs on the financial-portal conda Python** (`C:\tools\mambaforge\envs\financial-portal\python.exe`). Because of that, every instance shows up as 3 nested programs (launcher, pipx Python, conda Python). Removing or rebuilding that conda environment would break the tool.
- **How it is wired in:**
  - Tool connection: `C:\Users\zak_h\.claude.json`, under the top-level `mcpServers` key, entry `code-review-graph`, command `code-review-graph serve`. Its embedding settings point at local Ollama (`http://127.0.0.1:11434/v1`, model `qwen3-embedding-ctx2048:4b`). Because the entry is global, every session in every project starts its own copy.
  - Permissions: `C:\Users\zak_h\.claude\settings.json` allows `mcp__code-review-graph` and denies `apply_refactor_tool`, the one tool that writes source files. That is why sessions show 30 of its 31 tools.
  - Start-up step 1: `C:\Users\zak_h\.claude\hooks\graph-daemon.mjs`, listed under SessionStart in `settings.json`. In every git repo it runs `code-review-graph daemon add <repo>`. If the watcher is down it starts it in the background, which is hidden and opens no window. It prints "[graph-daemon] watcher alive for this repo". It never removes folders.
  - Start-up step 2: `C:\Users\zak_h\.claude\hooks\project-setup.mjs`. For repos with no index and no more than 3,000 code files, it builds one in the background and adds embeddings, stored under `%LOCALAPPDATA%\code-review-graph\graphs\`.
  - **No scheduled task, Windows service, Startup-folder entry or Run registry key.** The watcher only comes back when a Claude session starts and finds it down. The current one was started on 01/11 at 17:57.
- **Dates:** the oldest index is financial-portal's, created 14/05/2026, probably by an earlier install (unverified). The fork was cloned 29/07, the watch list created 17/08, and the current install dates from 17/08.

## 2. What it runs and what it costs

Snapshot taken 2026-11-03 around 13:10, by read-only listing:

| Part | Programs | Memory reserved | Notes |
|---|---|---|---|
| Watcher control process | 1 (plus 1 idle cmd shell) | 18 MB | Running since 01/11 17:57; it has no idle shut-off and never exits on its own |
| Folder watchers | 54 (18 folders × 3) | 0.9 GB | About 33 MB per folder; financial-portal 109 MB, tell-me-a-story-2 136 MB |
| Tool connection, one per Claude session | 24 (8 sessions × 3) | 4.5 GB | **About 566 MB each**, the largest cost, and it grows with every open tab |
| **Total** | **83** | **about 5.6 GB** | Out of 708 programs and about 135 GB reserved on the PC |

- **CPU:** mostly idle, with one exception. The `C:\dev\tell-me-a-story-2` watcher used 10,143 CPU-seconds (about 2.8 hours) since 01/11 18:03, roughly 7% of one core on average. The multi-manager watcher used 62 s and the others under 15 s. Each watcher rescans on file changes, checks every 2 s, and is restarted within 30 s if it dies.
- **Disk:**
  - Central store `%LOCALAPPDATA%\code-review-graph\graphs\`: 37 indexes, **3.8 GB**. 24 of them (1.7 GB) have not been touched in over 14 days, mostly old task copies of RTS-Commander and financial-portal. The largest is an old digital-survey-platform side copy, `bdn-tolerance`, at 1.1 GB.
  - Inside project folders: financial-portal **1.47 GB** and tell-me-a-story 548 MB, both in Dropbox and both kept out of git. The rest are small.
  - Logs and settings in `C:\Users\zak_h\.code-review-graph\`: 7.6 MB.
  - **Total about 6 GB.**

## 3. Which folders it watches and why stale ones stay

The watch list is `C:\Users\zak_h\.code-review-graph\watch.toml`, with 19 entries. 18 are live:

financial-portal, voyage_app, cargo-monitor-streamsync, digital-survey-platform and its old side copy `.worktrees\bdn-tolerance`, BOD_tools, bunker_survey_check-review-v060, tell-me-a-story, `C:\dev\tell-me-a-story-2`, multi-model-ai, RTS-Commander, DankEuroFighter, mobility-assistance, model-benchmark\contestants\box, session-voice, conflict-command, multi-manager, and a temporary multi-manager test folder in a session scratchpad (`...\4b67e829-...\scratchpad\ct\alpha-proj`). The 19th entry, `zz-mm-e2e-throwaway`, points at a folder that no longer exists.

- **How folders get added:** automatically. Start-up step 1 runs `daemon add` for any git repo a session opens in, including test folders that contain a git repo. That is how the scratchpad test project got in.
- **Why stale ones stay:** nothing ever removes them. Only a manual `code-review-graph daemon remove` does. Separate task copies are skipped by the start-up step, but a side copy that is its own repo (like `bdn-tolerance`) is not.
- A wider registry (`C:\Users\zak_h\.code-review-graph\registry.json`) holds 70 entries, including many old task copies and a Steam mod folder.

## 4. Does anything use it?

The scan covered every saved session log: 2,291 files (917 sessions, 1,374 helper-agent logs), 9.55 GB.

- **30 tool calls in total**, from 2026-09-21 to 2026-11-01, in 16 log files:
  - By project: financial-portal 16 (plus 1 in a financial-portal task copy), tell-me-a-story 9, RTS-Commander 4, multi-manager and everything else 0.
  - By tool: only 4 of the 30 tools were ever used. `semantic_search_nodes_tool` 14, `query_graph_tool` 11, `list_repos_tool` 3, `get_architecture_overview_tool` 2 (both of those failed with an argument error).
  - The review tools it is named for (`get_review_context_tool`, `detect_changes_tool`, `get_impact_radius_tool`, `build_or_update_graph_tool`) were **never** called.
- **By role:** 29 calls came from sessions you started by hand, including brainstorm helper agents, and 1 from a Multi-Manager developer (roster session #58, a financial-portal hotfix). Architects, project managers and the front desk: 0. **No Multi-Manager role depends on it.**
- The start-up message appears in 180 sessions across 39 project folders. The "watcher was down, started it" message appears in 16.
- About 14 shell commands ran the program directly, all admin tasks (help, add, remove, status, stop, restart) between 09/10 and 29/10.

## 5. Risks

- **What it reads:** files tracked in git, code types only (.py, .js/.jsx/.ts, .sh, .ps1, .sql, .yml and similar). **Never** .pdf, .docx, .xlsx, .msg, .eml, .md or .txt. Since 21/10 the watcher also skips files git ignores.
- **Does anything leave the PC?** Not through the tool. There is no telemetry and no error reporting. Embeddings go to local Ollama on 127.0.0.1, and the cloud embedding options (Google, MiniMax) have no keys set, so they can't run. The one indirect route is **Dropbox**: financial-portal's 1.47 GB index (code structure, function names, docstrings and file paths) lives in the Dropbox project folder. Dropbox uploads it and re-uploads its constantly changing files. The code itself is already in Dropbox, so this adds churn more than new exposure.
- **What it can change or run:** it runs `git` and its own build and watch programs. The one tool that rewrites source files (`apply_refactor_tool`) is blocked in your settings. `generate_wiki_tool` writes markdown into its own data folder. There is no general command-running tool.
- **financial-portal client data:** a read-only count of its index shows 4,975 code files (.py 3,033, .jsx 1,207, .js 683, .sh 44, other 8). There are **0 files** from `media/`, `kb/evals/eval_docs/`, `kb-test-docs/`, `dms-docs/` or `var/`. The client documents that git does track (20 PDFs, 17 Word files, 13 spreadsheets, 7 Outlook messages, 3 .eml emails) are not types it reads. One loose end: 199 git-ignored code files (`static/`, `conductor/`, `.playwright-mcp/`) were indexed before the 21/10 fix and are still in the index. They are code, not client documents. Unverified: whether any tracked YAML or SQL file holds client data. Those types are readable, but none showed up.

## 6. Its share in today's overload and the chance of a repeat

- **What happened:** the PC ran out of reserved memory (the "commit limit", 141 GB of RAM plus page file). When that happens, Windows refuses to start new programs. Git Bash reports this as "Resource temporarily unavailable", and other programs, like the local database server, crash. At around 13:10 there was still only 6.4 GB free.
- **Windows' own diagnosis** (System log, event 2004, 13:07:57): "python.exe (32576) consumed 57661140992 bytes, llama-server.exe (17500) consumed 15584526336 bytes, and llama-server.exe (35528) consumed 4352323584 bytes." PID 32576 is ComfyUI (started 08:47 today). The two llama-servers are the Ollama models, one 26B chat model and one older one.
- **code-review-graph's share:** about 5.6 GB of about 135 GB (around 4%), and 83 of 708 programs. Removing it would have bought about 5 GB of headroom. That might have delayed the crash, but would not have prevented it while ComfyUI held 54–58 GB.
- **Will it happen again?** Yes, whenever ComfyUI and a big local model run alongside a full set of Claude tabs and test runs. code-review-graph makes it a little worse each time: about 0.57 GB more per open session, plus a watcher for every new folder, and that list never shrinks.

## 7. Options

| Option | What changes | Saves | Costs you |
|---|---|---|---|
| A. Keep as is | Nothing | Nothing | About 5.6 GB memory and 83 programs today, growing with every tab and folder; 6 GB disk; 1.5 GB of Dropbox churn |
| B. Trim | Remove the stale folders from the watch list (temporary test folder, missing throwaway, `bdn-tolerance` side copy, old packages); delete indexes untouched for 14+ days; move financial-portal's index out of Dropbox | About 0.3 GB memory and 20–25 programs; about 3 GB disk; ends the Dropbox churn | Little. The per-session 566 MB cost, the biggest part, stays |
| **C. Make it on-demand (recommended)** | B, plus: remove the global tool connection and add it only to financial-portal and tell-me-a-story (the projects that used it); turn off the start-up step that adds every folder and starts the watcher | About 4–5 GB memory with 8 tabs open; about 75 fewer programs; faster session start-up | Its tools vanish from other projects (never used there). Indexes in the two kept projects refresh only when a session asks, not live |
| D. Remove entirely | Uninstall, remove both start-up steps and the tool connection, delete the data | All of it: about 5.6 GB memory, 83 programs, 6 GB disk | You lose the semantic code search used about 30 times in 6 weeks, mostly in financial-portal and tell-me-a-story by-hand sessions. Your fork stays on GitHub if you ever want it back |

**Recommendation: C.** It keeps the one thing that has been used (search in financial-portal and tell-me-a-story) and removes the always-on, ever-growing part that nobody relies on. It frees most of the memory. If you don't miss it within a few weeks, D is a small further step.

**Bigger lever for the overload itself:** ComfyUI held about 54–58 GB and the Ollama models about 20 GB. Closing ComfyUI when you're not generating images, or letting Ollama unload models when idle, protects far more headroom than anything on this list.

**Who can make the change:** options B–D edit your personal Claude Code settings (`~/.claude.json`, `~/.claude/settings.json`, the start-up step files) and your watch list. Under the standing rules, a config change needs your own go, typed by you, not relayed. Nothing has been changed.

## Method

- Processes: `Get-CimInstance Win32_Process` and `Get-Process`, read-only.
- Memory: `Win32_OperatingSystem` and `PrivatePageCount`.
- Windows System event log, event 2004.
- Folder sizes: `Get-ChildItem`.
- Config and source: read only.
- Session logs: streamed by scripts in the investigation's scratch folder, parsing tool-call records.
- financial-portal index: aggregate-only SQLite query opened read-only (it skips the latest uncommitted changes in the WAL file).
- Nothing was started, stopped or changed, and no windows were opened.
