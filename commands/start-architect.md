---
description: Start (or reuse) the architect for a project workstream, optionally with a goal
argument-hint: <project> [workstream] [goal text]
---
Start an architect. Arguments: $ARGUMENTS

1. Work out the project, the workstream (default `main`) and any goal text. Ask if the project is unclear.
2. If there is goal text, call `create_goal` first.
3. Call the roster tool `launch_architect` with the project, workstream and goal id.
4. Report the tab name (`mm-<project>-<workstream>`) and whether it was already running. Show any warnings verbatim. If it was already running and there is a new goal, `SendMessage` it "New goal: check roster goal #G".
