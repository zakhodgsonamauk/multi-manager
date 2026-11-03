# code-review-graph: changes made on 2026-11-03 (goal #102, part 1)

The user's go: roster item #935, answered by the user in the front-desk tab: "#935, B and C - additional, can we wrap management of code-review-graph per project under the project manager session?" Options B (trim) and C (on-demand) come from `report.md` in this folder.

## What changed, in plain words

- **The always-on watcher is off.** The background program that re-scanned 18 project folders every 2 seconds was stopped, and its 54 folder-watcher programs were closed by their own process ids. Nothing starts it again: the start-up step that did so was removed.
- **New folders are no longer added automatically.** The start-up step that added every folder a session opened in (`graph-daemon.mjs`) is no longer run at session start.
- **No automatic index builds.** The other start-up step (`project-setup.mjs`) still writes its Python code-navigation settings, but it no longer builds a code-review-graph index for new projects.
- **The tool connection is now only in two projects.** It used to start in every Claude session in every project (about 566 MB each). It now starts only in sessions opened in financial-portal and tell-me-a-story, the two projects that actually used it.
- **The watch list is down from 19 folders to 2** (financial-portal, tell-me-a-story), so a manual restart of the watcher would stay small.
- **Stale data cleared: about 3.0 GB.** 25 indexes deleted (see list below) and 53 dead entries removed from the tool's list of known folders (70 down to 17).
- **financial-portal's index now lives outside Dropbox**, at `C:\Users\zak_h\AppData\Local\code-review-graph\graphs\financial-portal-moved-20261103\`. The old copy was deleted later the same day, and tell-me-a-story's index was moved too (see the end of this file).

## Files changed (all backed up first)

Backups: `C:\Users\zak_h\.claude-backups\crg-2026-11-03\` (outside Dropbox). It also holds the before/after process lists (`processes-before.csv`, `processes-after.csv`) and the index list before cleanup (`indexes-before.csv`).

| File | Change | Backup |
|---|---|---|
| `C:\Users\zak_h\.claude\settings.json` | Removed the SessionStart entry that ran `graph-daemon.mjs`. Permissions for the tool were left as they were (harmless when the tool is absent). | `settings.json` |
| `C:\Users\zak_h\.claude\hooks\project-setup.mjs` | Added `AUTO_BUILD_GRAPHS = false`; `setUpGraph` returns at once. The Python-settings job is unchanged. | `project-setup.mjs` |
| `C:\Users\zak_h\.claude.json` | Removed the global `code-review-graph` tool connection (`claude mcp remove code-review-graph -s user`). Added the same connection, same settings, for the two projects only (`claude mcp add-json code-review-graph ... -s local`, run from each project folder). Done with Claude's own command so running sessions' writes to this file are not overwritten. | `claude.json` |
| `C:\Users\zak_h\.code-review-graph\watch.toml` | 19 folders down to 2. | `watch.toml` |
| `C:\Users\zak_h\.code-review-graph\registry.json` | 70 entries down to 17; financial-portal entry now points at the new index location. | `registry.json` |
| `C:\Users\zak_h\.claude\hooks\graph-daemon.mjs` | Not changed, just no longer run. | `graph-daemon.mjs` |

## Evidence (automated, read-only checks)

**Programs and memory (code-review-graph only):**

| | Programs | Memory reserved |
|---|---|---|
| Before (13:20) | 88 (4 watcher-control, 54 folder watchers, 30 tool connections) | 6,634 MB |
| After (13:26) | 30 (tool connections in already-open tabs only) | 5,680 MB |

The 30 remaining programs are the tool connections inside the 10 Claude tabs that were already open. Running tabs were not touched, as agreed. As each tab outside financial-portal and tell-me-a-story is restarted, its copy (about 566 MB, 3 programs) goes away. Expected end state with the same 10 tabs: about 5 GB less than before.

**Config read-back:**
- Global tool connections: `second-opinion`, `claude-context-sync`, `reddit` (no `code-review-graph`).
- Local tool connection `code-review-graph serve` present for `I:/Dropbox (Personal)/ZakHodgson/Projects/financial-portal` and `I:/Dropbox (Personal)/Projects/tell-me-a-story`.
- SessionStart hooks now: `conflict-check.mjs`, `project-setup.mjs`, `project-health.mjs`.
- `node --check project-setup.mjs`: passes. Running it in the multi-manager folder printed nothing and started no build; 0 watcher programs 5 seconds later.
- `code-review-graph daemon status`: lists only financial-portal and tell-me-a-story, and the watcher is not running.
- The tool's own folder lookup (`get_data_dir`) now resolves financial-portal to the new location; the new index opens and has 85,190 entries.

**financial-portal index copy** (SQLite's safe online-copy, source opened read-only; nothing written inside the financial-portal folder):

| | Original (in Dropbox) | Copy (outside Dropbox) |
|---|---|---|
| Size | 1,537,693,561 bytes (3 files: database plus its two side files) | 1,399,447,552 bytes (1 file; the side files' pending changes are folded in) |
| Tables | 15 | 15 |
| Row counts | nodes 85,190; edges 669,808; embeddings 16,170; flows 6,882; flow memberships 784,090; communities 30; risk index 29,696 | identical in all 15 tables |
| Integrity check | | ok |

Copy took 83 seconds.

**Indexes deleted (about 3.0 GB):**
- `bdn-tolerance` (old digital-survey-platform side copy): 1,193 MB
- `fp-956-weather-downloads` (old financial-portal task copy, untouched for 25 days): 773 MB
- 22 old conflict-command task copies (`001-...` to `023-...`, untouched for 16 days): 1,012 MB together
- `combined_40k_conquest` (a Steam mod folder): 16 MB

Index folder total now 2.3 GB, including the new 1.4 GB financial-portal copy.

**Not deleted (kept on purpose):** recent indexes of live projects (conflict-command, digital-survey-platform, voyage_app, multi-manager, tell-me-a-story-2 and 8 small ones, about 0.9 GB). No running program uses them now. They are kept so part 2 (each project manager decides whether its project uses the tool) does not start from a rebuild. Easy to delete later.

## How to undo

Everything (restores the old setup exactly, except the deleted indexes):

```powershell
$b = "C:\Users\zak_h\.claude-backups\crg-2026-11-03"
Copy-Item "$b\settings.json"     "$HOME\.claude\settings.json" -Force
Copy-Item "$b\project-setup.mjs" "$HOME\.claude\hooks\project-setup.mjs" -Force
Copy-Item "$b\watch.toml"        "$HOME\.code-review-graph\watch.toml" -Force
Copy-Item "$b\registry.json"     "$HOME\.code-review-graph\registry.json" -Force
```

Then put the tool connection back globally with Claude's own command (safer than copying `claude.json` back, which would undo every other change Claude has saved there since):

```powershell
claude mcp add-json code-review-graph '{"type":"stdio","command":"code-review-graph","args":["serve"],"env":{"CRG_OPENAI_BASE_URL":"http://127.0.0.1:11434/v1","CRG_OPENAI_API_KEY":"ollama","CRG_OPENAI_MODEL":"qwen3-embedding-ctx2048:4b","CRG_OPENAI_DIMENSION":"512"}}' -s user
```

and, from each of the two project folders, `claude mcp remove code-review-graph -s local`. The watcher comes back by itself the next time a session starts.

Only the financial-portal index move: restore `registry.json` from the backup (the old copy is still in place).

Deleted indexes: rebuilt on demand with `code-review-graph build --repo <folder>`. The task-copy folders they belonged to are mostly gone already.

## Follow-ups, done the same day (user's go: roster item #944, answered "go on all")

**1. financial-portal's old index deleted from Dropbox.** Before deleting, each of its files was opened with exclusive, read-only access. All four opened, so no running tab held them. The newest write to the database was at 12:20, before the copy was made at 13:22, so the copy has everything. Deleted: `financial-portal\.code-review-graph\` (1,537,693,561 bytes, 4 files, git-ignored). Nothing else in the project was touched.

**2. tell-me-a-story's index moved out of Dropbox**, the same way as financial-portal's:

| | Original (in Dropbox) | Copy (outside Dropbox) |
|---|---|---|
| Location | `I:\Dropbox (Personal)\Projects\tell-me-a-story\.code-review-graph\` | `C:\Users\zak_h\AppData\Local\code-review-graph\graphs\tell-me-a-story-moved-20261103\` |
| Size | 684,906,401 bytes (3 files) | 574,877,696 bytes (1 file) |
| Row counts | nodes 36,104; edges 212,394; embeddings 24,617; flows 4,341; flow memberships 1,880,513; risk index 34,756 | identical in all 15 tables |
| Integrity check | | ok |

- The tool's folder list (`registry.json`) now points tell-me-a-story at the copy. The tool's own lookup resolves both projects to their new copies (financial-portal 85,190 entries, tell-me-a-story 36,104).
- The original's files were checked free (exclusive open) and deleted. Its last database write was at 13:14, before the copy.
- Backup of the folder list as it stood before this step: `C:\Users\zak_h\.claude-backups\crg-2026-11-03\registry-after-part1.json`.

**Undo for these two:** the copies hold the same data. To put an index back inside its project folder:
1. Copy `graph.db` from the new location into `<project>\.code-review-graph\`.
2. Remove that project's `data_dir` line from `registry.json`, or restore `registry.json` from the backup folder.

## Still open

1. **Task copies don't get the tool.** The local tool connection matches the exact project folder, so a developer working in a temporary copy (`<project>\.claude\worktrees\<name>`) won't see it. In six weeks, that happened once. It was not in the go; it is left for part 2.
2. **Running tabs still carry the tool** until they restart (30 programs, 5.7 GB at 13:26). No tab was restarted, as agreed.
