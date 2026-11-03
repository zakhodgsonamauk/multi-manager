# 013 — Project manager briefing and skills; front desk routing; architect and README updates

Goal #89 (workstream `pm-role`, branch `main`). Waits for task 011 (needs its tool names); can run beside task 012 (no shared files). Developer branch: `worktree-mm-multi-manager-pm-role-dev-013-pm-docs` (dev #297). Return report: `docs/multi-manager/tasks/013-pm-briefing-skills-docs.return.md` on your branch.

## Goal
The project manager stops being "a long goal text the front desk pastes in each time" and gets its own written role, like the front desk and architects have. The front desk knows to route work to a project's project manager when one runs. Architects know their sign-offs go straight to the user's desk while their project manager watches. The README describes the four-level team.

## Source material (read first)
- The duties as practised, in roster goals #42, #69, #81 (read with `get_goal`): sort user input into pieces; per piece `add_workstream`, `create_goal` (the user's words verbatim plus a note), `launch_architect`, or send "New goal: check roster goal #G" to a running architect that fits; watch overlap (same files, migrations, the roster database and running server for this project, one production release at a time and only on the user's go); report one line per piece to the front desk; never approve a sign-off; stop architects whose goals are done; start by checking in, then wait. Do not build or dispatch developers.
- Goal #89's text: the project manager's practice note (how the relay worked, which tool arguments tripped it) and the standing rules list.
- Tasks 010 and 011 as merged: `launch_project_manager`, `restart_architect` covering project managers, `set_project_rules`, watched items, the start-up rules block.

## What to write
1. `briefings/project-manager.md` (replaces 010's placeholder), in the same voice and size as `briefings/architect.md`: identity from the environment; repo files are the source of truth (`docs/multi-manager/pm/` status, progress, decisions); start (goal, items, rules); check-in timer (same tick job as architects); each piece of input; overlap watch; sign-offs (they go to the front desk directly, you watch; you may add one `info` item to the front desk if you see an overlap or risk the user should know before answering, never an approval); `done` items (check evidence, stop the architect, report); standing rules (`set_project_rules` when the user states a new standing rule, verbatim); spend; pause and resume; "Always" rules (quote the user verbatim, only an answered roster item is consent, nudge after every `raise_item`, never restart an architect yourself: report to the front desk).
2. `commands/pm-intake.md` (new skill, project manager): turn one piece of user input into workstream → goal → architect, or a nudge to a running architect; check for overlap first; one line back to the front desk.
3. `commands/tick.md`: a project manager branch (its `team_health` view from task 012: nudge, nudge, then report a stuck architect to the front desk; stop architects whose goals are done).
4. `commands/start-architect.md` / `stop-architect.md` / `status.md`: mention project managers where they apply.
5. `briefings/front-desk.md`: routing — work for a project goes to its running project manager (create the goal on the `pm` workstream, or send "New goal" to it); if none runs, straight to an architect as today; one project manager per project; `launch_project_manager` when the user asks for one or a project has several workstreams running at once (suggest it, the user decides); standing rules via `set_project_rules`, verbatim, and stop re-pasting them into goal texts; sign-offs from architects arrive directly.
6. `briefings/architect.md`: "nudge the front desk" becomes "nudge whoever the item is addressed to (the reply names them)"; sign-offs and questions go to the front desk even under a project manager; `done`, `blocked`, `info` go to your project manager when you have one; standing rules arrive at start-up.
7. `commands/plan-goal.md`, `wrap-goal.md`, `dispatch.md`: same nudge wording fix where they say "front desk".
8. `README.md`: intro and "Use" sections describe front desk → project manager → architects → developers, when to use a project manager, the new tools and skill, and standing rules.

## Tests first
`test/briefings.test.ts`: add failing checks that `briefings/project-manager.md` exists and names `launch_architect`, `set_project_rules`, `stop_architect` and the rule never to approve a sign-off; that every tool name mentioned in any briefing or command file is a real registered roster tool (if this check already exists, extend it to the new file and skill); that `commands/pm-intake.md` has valid skill front matter like the other commands (`test/command.test.ts` or `test/plugin-manifest.test.ts`, whichever checks commands today).

## Files expected to change
`briefings/project-manager.md`, `briefings/front-desk.md`, `briefings/architect.md`, `commands/pm-intake.md` (new), `commands/tick.md`, `commands/start-architect.md`, `commands/stop-architect.md`, `commands/status.md`, `commands/plan-goal.md`, `commands/wrap-goal.md`, `commands/dispatch.md`, `README.md`, `test/briefings.test.ts` (and the command test). `claim` the briefings before editing; release after your return.

## Out of scope
Code in `src/` or `hooks/`. Writing standing rules for real projects. Relaunching the running project manager. Reloading the plugin. Pushing.

## Test scope
`node --test test/briefings.test.ts test/command.test.ts test/plugin-manifest.test.ts`, `npm run lint`, `claude plugin validate .`. No full suite.

## Evidence required
Pass/fail summary lines. Word count of each briefing before and after (the briefings are loaded into every session; keep the project manager briefing no longer than the architect one).

## As merged (architect's note, 2026-11-03)
- 010 (`24123ba`): tools `launch_project_manager` (front desk only; optional goal), `stop_project_manager`; `restart_architect` also takes a project manager; tab name `mm-<project>-project-manager`. `briefings/project-manager.md` is a placeholder to replace.
- 011 (`155c99a`): `raise_item` reply has `nudge` and, for a watched item, `watcher_nudge` (send both); `answer_item` reply likewise. A watcher cannot answer, close or mark seen an item it only watches. `set_project_rules` (front desk, or the project's running project manager). `list_items` default includes watched items flagged `watching: true`. `list_workstreams` takes a name or id; `stop_architect` takes `session_id`; `mark_seen` takes `item_id` or `item_ids`.
- Watched items do not show in the Stop hook's list: the project manager learns of them from `watcher_nudge` and `list_items` (say so in its briefing and tick).
