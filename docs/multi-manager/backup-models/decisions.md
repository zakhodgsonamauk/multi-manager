# Decisions

Dated, newest last. Each: decision, context, alternatives considered.

## 2026-11-24 Multi-Manager gets its own backend definitions; the Dropbox launchers stay as they are
Context: the five Dropbox launchers all do the same thing (set `ANTHROPIC_BASE_URL`, a token and model names, then run `claude`), but the box and Strata ones also switch off almost every plugin, set the window title and run the proxy inside the window. Multi-Manager sessions need their own plugin and roster connection on, run in managed tabs, and must not leave proxies behind.
Decision: port the settings (addresses, model mapping, context margins, readiness checks) into `src/backends/` as data plus small checks. Do not call the .bat files. Do not edit the Dropbox files; they remain the user's standalone launchers.
Alternatives: call the .bat files from the tab wrapper (rejected: plugins switched off, no control of proxy lifetime); move the scripts into the repo (rejected: the user's other projects use them, and the goal says do not edit them).

## 2026-11-24 Keys are read by the tab at start-up, never written down
Context: the box key lives in `LEADERGPU_LLM_KEY` (user environment / registry). Multi-Manager writes a settings file per session.
Decision: settings files hold only addresses and model names. The tab's start-up script copies the key from the named environment variable into `ANTHROPIC_AUTH_TOKEN` for that one process. Tests scan every written file for a fake key.
Alternatives: put the token in the settings env block (rejected: key on disk in the roster folder).

## 2026-11-24 Noticing "usage ran out" is done by plain code, not by a model session
Context: when Claude usage runs out, every Claude session stops answering at once, the front desk and this architect included. A roster item for the front desk would sit unread.
Decision: the monitor spots the limit message in transcripts; the pane (plain code inside the front desk window, which still runs) shows the offer and does the switch.
Alternatives: front desk handles it (rejected: it is out of usage too).

## 2026-11-24 Switching keeps the conversation by resuming it
Context: transcripts are stored locally, so `--resume` should work whichever backend answers. `changeSessionModel` already relaunches with `--resume`. `restart_developer` does not resume.
Decision: the switch reuses the resume path for every role. Task 034 checks it by hand first and falls back to a fresh start with the task re-sent when a backend's context is too small.

## 2026-11-24 Shared proxies, one per backend, stopped when unused
Context: Strata needs a litellm proxy, GPT needs claude-code-proxy. The Strata launcher starts one per window.
Decision: Multi-Manager runs at most one proxy per backend, counts its users, and stops it when the last one stops.

## 2026-11-24 Order of work around goal #2
Context: goal #2 (usage-efficiency) is changing `src/launch/command.ts`, `launcher.ts`, the monitor and the pane in tasks 026, 027, 029, 031.
Decision: 032 touches only new files and starts now. 033-036 wait for those tasks to merge.

## 2026-11-24 Hand-off with goal #2's task 027 (fresh restarts, idle auto-stop)
Context: the project manager flagged that 027 restarts big idle managers fresh and auto-restores stopped ones, through `restartArchitect` and `src/monitor/`, the same area as 034/035.
Decision: 033 and 034 also wait for 027. 033 makes every relaunch path read `backend` from the roster row, so a 027 restart keeps a session on its backup. 035 adds an "out of usage" guard to 027's lifecycle decision so an out-of-usage session is not idle-stopped or restarted on Claude. Confirmed by architect #3 on 2026-11-24: 027 has no relaunch path that bypasses `restartArchitect` (`src/monitor/lifecycle.ts:164`); the guard covers all three lifecycle decisions (fresh restart, idle stop, bring-back); do not wait on 031; start 033 once 026 merges.
Building anything, 032 included, waits for the user's answer on sign-off #13.

## 2026-11-24 Sign-off #13 answers applied
Only three backups: `glm`, then `box`, then `strata`, in that order ("glm, then box, then strata ONLY"). GPT and MiniMax are not built. Every role may go on a backup ("Q3 - all"), so the batch switch includes the front desk and project managers; the front desk is switched last because its window hosts the side pane. Q1 (ask or auto) not answered: the default `ask` stands, with `auto` still available as a project setting. Launcher copies stay in the project folder, ignored by git ("hold them for now but gitignore them").

## 2026-11-24 Model comparison result: thinking must be off for glm and box
Context: item #17 comparison (comparison/README.md). With thinking on, glm and box spent the whole answer budget thinking and produced no code; with it off, glm 16/16 in 1.4 s, box 14/16 in 2.6 s, Strata 16/16 in 4.1 s.
Decision: offered the user a glm thinking-off option and a box server setting (item #22). Not built until the user answers; the box server is outside this repo.

## 2026-11-24 Tests that touch real backends or start programs run headless only
Context: item #29 (test windows on the user's screen while gaming) and item #27 ("can run tests but only if headless!").
Decision: every test start of a program is hidden and cleaned up (task 037). 033's real-backend check becomes a headless run (no tab). Fixes for #29 go to a helper agent in its own copy of the project, not a developer tab, so nothing new appears on screen.
