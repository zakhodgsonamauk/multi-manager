---
description: Check-in tick for the self-armed timer: check team health and act on it
argument-hint: (none; the timer runs it)
---
Multi-Manager check-in tick. $ARGUMENTS

Your role is `MM_ROLE` from the environment (your briefing says it too). No `MM_ROLE` means you are the front desk. Developers have no tick: if you are a developer, say "no tick for developers" and stop.

1. FIRST call `team_health`. If `paused` is true, say "paused — tick skipped" and stop. Do nothing else.
2. Act on each session's `recommended_action`, as below for your role. `none` means leave it alone.
3. Keep the output short. If nothing changed and nothing needed action, say one line: "all quiet". Never a wall of text.

## Architect
- `check_in`.
- `list_items`: handle anything addressed to you that you have not seen yet, as your briefing says.
- For each developer in `team_health`:
  - `nudge`: `SendMessage` the developer "Are you stuck? Report via the roster, or carry on." Then `record_nudge` with its `session_id`.
  - `restart`: `restart_developer` with its `session_id`. Log it in `progress.md`.
  - `report`: `raise_item` kind `blocked` to the front desk with the session name, state and `reason` verbatim. Then `SendMessage` the front desk "check roster item #N".

## Front desk
- `status` as well as `team_health`.
- Show the user ONLY what is new since your last tick: new waiting items (number, project, kind, body quoted verbatim) and new problems (stuck, hung or dead architects, with `reason` quoted verbatim). Do not repeat what the user has already seen.
- Idle stop: stop (`stop_architect`) any architect idle past its project's idle stop time with nothing assigned. Tell the user in one line.
- For each architect in `team_health`:
  - `nudge`: `SendMessage` the architect "Are you stuck? Report via the roster, or carry on." Then `record_nudge` with its `session_id`.
  - `report`: tell the user plainly which architect, what state, and the `reason` verbatim. Ask what to do.
