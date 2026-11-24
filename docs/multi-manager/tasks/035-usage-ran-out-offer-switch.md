# 035 — Notice Claude usage ran out and offer the switch

Goal #4. Branch: `<filled in at dispatch>`. Return report: `docs/multi-manager/tasks/035-usage-ran-out-offer-switch.return.md` on that branch.
Waits for: task 034 merged, task 036 merged (both touch the pane), goal #2's tasks 026 and 027 merged (same monitor files).

Hand-off with goal #2's task 027: a session out of Claude usage looks idle, so 027's idle-stop and fresh restart would act on it. Add a guard to all three lifecycle decisions in `src/monitor/lifecycle.ts` (fresh restart, idle stop, bring-back on an item): skip any session flagged out of usage. One test per decision. (Agreed with architect #3 on 2026-11-24; see `docs/multi-manager/backup-models/decisions.md`.)

## Goal
When Claude usage runs out, **every** Claude session stops answering at once, the front desk included. So noticing it and offering the switch must be done by plain code (the monitor and the pane), not by a model session.

- The monitor reads each live session's transcript tail for the usage-limit message Claude Code writes. First collect real examples: search the user's existing transcripts under `~/.claude/projects` for the limit messages (and their reset time), and paste the exact wording (no other content) in the return report. Build the matcher from those.
- When found: mark the session `out-of-usage` with the reset time, in the roster.
- The pane shows one banner: "Claude usage ran out (resets <time>). N sessions stopped. Switch them to [backup]?" listing the backends that pass their readiness check, in the user's preferred order, and one button. The button calls 034's batch switch. A second line offers the front desk too.
- After the reset time, the banner offers "Claude is back. Switch N sessions back?" the same way.
- Project setting `backup_mode`: `ask` (default) or `auto` (switch to the first ready backup without asking, and back after reset; the banner then just reports what happened).
- Record each episode as an `info` roster item so the front desk sees it once it is answering again.

## Tests first
In `test/usage-limit.test.ts`: the matcher recognises each pasted real example and its reset time, and ignores ordinary text that mentions limits; the monitor marks sessions and clears the mark after reset; `auto` mode calls the batch switch once, not once per tick; `ask` mode never switches by itself. Pane: extend the existing mod tests (`npm run test:mod`) for the banner states.

## Files expected to change
`src/monitor/` (detection), `src/roster/db.ts` (session flag, project setting; claim it), `hooks/register.tsx` and `hooks/roster-view.ts` (banner), `src/roster/tools.ts` (`set_project_backup_mode`), tests.

## Out of scope
Changing how any backend works; spend tracking for backups.

## Test scope
`node --test test/usage-limit.test.ts`, `npm run test:mod`, `npm run typecheck`, `npm run typecheck:mod`, eslint on changed files.

## Evidence required
Test summary lines. Screenshots of the pane banner in its three states (ran out, switching done, Claude back), produced with a fake transcript line on a throwaway session, opened and judged for design and flow.
