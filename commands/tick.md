---
description: Check-in tick for the self-armed timer: check team health and act on it
argument-hint: "(none; the timer runs it)"
---
Multi-Manager check-in tick. $ARGUMENTS

Your role is `MM_ROLE` from the environment (your briefing says it too). No `MM_ROLE` means you are the front desk. Developers have no tick: if you are a developer, say "no tick for developers" and stop.

1. FIRST call `team_health` (the front desk: see its section below, which replaces steps 1 to 3). If `paused` is true, say "paused — tick skipped" and stop. Do nothing else.
2. Act on each session's `recommended_action`, as below for your role. `none` means leave it alone.
3. Keep the output short. If nothing changed and nothing needed action, say one line: "all quiet". Never a wall of text.

## Architect
- `check_in`.
- `list_items`: handle anything addressed to you that you have not seen yet, as your briefing says.
- For each developer in `team_health`:
  - `nudge`: `SendMessage` the developer "Are you stuck? Report via the roster, or carry on." Then `record_nudge` with its `session_id`.
  - `restart`: `restart_developer` with its `session_id`. Log it in `progress.md`.
  - `report`: `raise_item` kind `blocked` to the front desk with the session name, state and `reason` verbatim. Then `SendMessage` the front desk "check roster item #N".

## Project manager
- `check_in`. `list_items` (watched items too, flagged `watching: true`; they do not show in the Stop hook list).
- For each architect in `team_health`:
  - `nudge`: `SendMessage` the architect "Are you stuck? Report via the roster, or carry on." Then `record_nudge` with its `session_id`.
  - `report`: after two nudges, `raise_item` kind `blocked` to the front desk with the architect, state and `reason` verbatim. Then `SendMessage` the returned nudge. Never restart an architect yourself.
- Stop (`stop_architect`) architects whose goals are done and which have nothing assigned. Report in one line to the front desk.

## Front desk
The pane swallows check-ins with nothing to act on, so a tick that reaches you has news, or the pane is not loaded. Output at most three short lines, impact first. Never a wall of text, never "all quiet" on a tick with a digest.
- A digest (JSON with `quiet`, `paused`, act_on, idle_past_limit, new_items, `fingerprint`) is in your context from the pane: act from it. Do not call `status` or `team_health` unless you need a detail it lacks.
- No digest in your context (the pane is not loaded): call `front_desk_digest` first. If it says `paused` true, say "paused — tick skipped" and stop. If `quiet` is true, say "all quiet" and stop. Only if that tool is missing (an older roster server), fall back to calling `team_health` (stop if `paused`) and `status`, show only what is new since your last tick, and stop (`stop_architect`) any architect idle past its project's idle stop time with nothing assigned (tell the user in one line). Nudge and report each session by its `recommended_action`, as below.
- new_items: show each new item the user has not seen (number, project, kind, body quoted verbatim). Do not repeat what the user has already seen. After showing them, call `mark_seen` with their ids (`item_ids`) so the next digest leaves them out.
- idle_past_limit: stop (`stop_architect`) each architect listed, with nothing assigned. Tell the user in one line.
- act_on: for each session listed, by its `action`:
  - `nudge`: `SendMessage` it "Are you stuck? Report via the roster, or carry on." Then `record_nudge` with its `id`. Project managers are nudged and reported the same way as architects.
  - `report`: tell the user plainly which session, what state, and the `reason` verbatim. Ask what to do.
