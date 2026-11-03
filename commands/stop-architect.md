---
description: Stop the architect for a project workstream and close its tab
argument-hint: <project> [workstream]
---
Stop an architect. Arguments: $ARGUMENTS

Confirm the project and workstream (default `main`), then call the roster tool `stop_architect`. Report whether its process was killed (its tab closes fully). A project manager is stopped with `stop_project_manager`; a project manager may stop architects of its own project when their goals are done and show any warnings verbatim. The architect's developer sessions are stopped too. Architects running under it are not stopped: they move to the project's running project manager (the result's `next` line says who to tell); with no project manager running, nothing is stopped.
