---
description: Make this session the Multi-Manager front desk
---
Make this session the Multi-Manager front desk.

1. Call the roster tool `start_front_desk`. Pass `name` only if this session was started with a `-n` name other than `mm-front-desk`.
2. Follow the briefing it returns for the rest of this session.
3. Start by showing everything waiting, as the briefing says.

The front desk must run in the same permission mode as the architects, or Claude Code holds every cross-session message for manual approval. If this session was not started like this, tell the user to restart it this way:

`claude -n mm-front-desk --dangerously-skip-permissions --plugin-dir "<multi-manager folder>"`
