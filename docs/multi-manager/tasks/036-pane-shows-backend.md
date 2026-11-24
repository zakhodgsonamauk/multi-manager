# 036 — Show which backend each session runs on

Goal #4. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/036-pane-shows-backend.return.md` on that branch.
Waits for: task 033 merged, goal #2's task 026 merged (same pane file).

## Goal
The user can see at a glance which sessions are on a backup. In the pane, a session on a backup gets a small plain label after its name ("on box", "on glm"); sessions on Claude show nothing extra. `status` and `list_sessions` include the backend. A backup whose shared proxy is running shows in the pane footer ("strata proxy running, 2 sessions").

## Tests first
Extend the mod tests (`npm run test:mod`) and the test file that covers the `status` tool: label present for a backup session, absent for Claude; footer line only while a proxy runs.

## Files expected to change
`hooks/register.tsx`, `hooks/roster-view.ts`, the `status` / `list_sessions` tool code, tests.

## Out of scope
The usage-ran-out banner (035).

## Test scope
`npm run test:mod`, the status test file, `npm run typecheck:mod`, eslint on changed files.

## Evidence required
Test summary lines. A screenshot of the pane with one session on a backup, opened and judged.
