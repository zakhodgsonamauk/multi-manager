---
description: Step a session's model up or down (a running tab relaunches on the new model, conversation preserved)
argument-hint: <project or session name> <haiku|sonnet|opus>
---
Change a session's model. Arguments: $ARGUMENTS

1. `list_sessions` to find the session. Sessions are named `mm-<project>-<workstream>` (architects) and `mm-<project>-<workstream>-dev-<label>` (developers). Ask if it is unclear; never guess between projects.
2. Call `set_session_model` with the session id and the model. A running tab is relaunched on the new model with its conversation preserved; a stopped one records the model for its next launch.
3. Report the change and any warnings verbatim. To set a standing default for a project instead, call `set_project_default_model`.
