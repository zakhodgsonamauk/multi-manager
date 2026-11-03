# Decisions — workstream `pm-handover`

One dated entry per decision, newest last. Never rewrite an old entry: add a new one that supersedes it.

## 2026-11-03 — Hand-over happens inside stop_architect (task 015)

- Context: goal #98. Old-style project managers are architects on the `pm` workstream with architects under them. `stop_architect` stops children first (`src/launch/launcher.ts:304`), and no tool moves an architect to a new parent.
- Decision: `stopArchitect` moves the stopped architect's running architect children to the project's running real project manager, then stops the old one as before (its own developers still stop). The rule is "an architect with architects under it", not "the workstream is named pm", so it covers any old-style manager. The logic sits in `stopArchitect`, not `stopSession`, so pause, idle-stop, `stop_project_manager` and `stop_developer` keep stopping everything.
- Alternatives: a separate front-desk "hand over" tool (one more tool to learn and a second step to forget; the stop is the natural switch point). Putting it in `stopSession` (would change pause, which must stop everything).
- Who: the architect (#304).

## 2026-11-03 — No project manager running: refuse (task 015)

- Context: what `stop_architect` does on an architect with architects under it when the project has no real project manager.
- Decision: refuse, stop nothing, and say how: launch the project manager first, or stop those architects first (named). Message leads with "Not stopped:" because the sidebar pop-up shows only 120 characters.
- Alternatives: keep today's behaviour (silently kills architects mid-build, the exact accident this goal prevents; stopping everything is still possible by stopping the architects first, or with pause).
- Who: the architect (#304).

## 2026-11-03 — launch_project_manager does not adopt at launch (task 015)

- Context: the goal asked to consider adopting the old pm's architects when the real project manager launches.
- Decision: no. The old pm keeps coordinating until it is stopped; the stop is the one switch point.
- Alternatives: adopt at launch (two managers live at once with the architects already moved, items in flight to the old one, and the old pm still sending them nudges; two places to move items).
- Who: the architect (#304).

## 2026-11-03 — Live items move with the architects (task 015)

- Context: open items a handed architect raised to the old pm would be read by nobody once it stops; an answer to a sign-off the old pm relayed would go back to the stopped old pm.
- Decision: re-route the handed architects' live items that name the old pm, using the normal routing for their new parent (done/blocked/info to the project manager; open sign-offs and questions straight to the front desk with the project manager watching). The old pm's own items are left alone. A sign-off the old pm already relayed may show twice at the front desk; the architect's own copy is the one whose answer reaches it.
- Alternatives: leave items (stranded); move the old pm's own items too (bigger, and they are about its own coordination).
- Who: the architect (#304).

## 2026-11-03 — No separate plan sign-off

- Context: approval rules ask for plan and testing sign-off. Goal #98 text: the user's "go" (item #919: "sure, go on the follow-up") covers this; "raise a plan sign-off only if the work grows beyond it."
- Decision: one task, within the approved follow-up, so no sign-off raised. Testing: focused unit tests on a throwaway roster (task 015 list) plus an end-to-end run on a throwaway roster with fake launches. No user-facing screen changes, so no click-through (the sidebar's stop button only shows the new refusal text through its existing pop-up).
- Who: the architect (#304).

## 2026-11-03 — Re-route reuses defaultRoute (task 015 build)
- `rerouteItems` runs after the parent change and calls `defaultRoute`, so moved items follow exactly the rule new items follow. Answered items only lose an old-pm watcher. Hand-over result adds `handed_over` and `next`; other stop results unchanged.
