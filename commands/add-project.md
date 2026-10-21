---
description: Add a project and its workstreams to the Multi-Manager roster
argument-hint: <name> <folder>
---
Add a project to the Multi-Manager roster. Arguments: $ARGUMENTS

Ask only for what is missing: name; folder (absolute path); extra workstreams with their branches (every project gets `main` on branch `main` unless told otherwise); approval rules; permission mode; idle stop minutes; daily budget in USD. Offer the defaults and accept them if the user does not care. The defaults are: sign-off on the high-level plan and testing approach; dangerously-skip-permissions; 120 minutes; no budget.

Then call the roster tool `add_project` and show the result. If it returns a warning, show it verbatim.
