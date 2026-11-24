# 028 return: cheaper helpers and nudges

## What changed
- `raise_item` and `answer_item` send no `watcher_nudge` when the watcher is a project manager and the item is a sign-off or question (`shouldNudgeWatcher`, `src/roster/items.ts`). Other watchers and kinds still get one.
- Duplicate nudges for the same item to the same session are dropped (`NudgeLedger`, used in `src/roster/tools.ts`). A dropped answer nudge returns `nudge: null, nudge_skipped: 'duplicate'`.
- Architect and project-manager briefings: research helpers on Sonnet, Haiku for plain searching, pass `model` on the Agent tool, Opus only for judgement reviews. Architect Fable line: "kept for the single hardest decision". Both: idle manager past the limit is restarted fresh; keep `status.md` and `progress.md` current before idle.
- Developer briefing: "Report to your architect only through `done` and `blocked`: no running commentary."
- `commands/dispatch.md`, `review-return.md`, `plan-goal.md`: helper-agent model lines.
- Extra (architect message from task 027): `commands/tick.md` front desk section gets "refresh_due: for each entry, `SendMessage` that manager the entry's `message`, once." The act_on handling lives in tick.md, not front-desk.md, so it went there. Test added.
- Architect briefing size cap in tests raised 7500 -> 8000 (comment added).

## Briefing lines (quoted)
- architect.md: "Run read-only research and search helpers on Sonnet, or Haiku for plain searching, by passing `model` on the Agent tool; Opus only for a review that needs judgement."
- both: "An idle manager whose conversation grows past the project's limit is restarted fresh by the system, so before going idle keep `status.md` and `progress.md` current: a fresh start resumes from them."
- developer.md: "Report to your architect only through `done` and `blocked`: no running commentary."

## Tests
`node --test test/items.test.ts test/briefings.test.ts test/signoff-tools.test.ts`:
```
ℹ tests 34
ℹ pass 34
ℹ fail 0
```
`npm run typecheck` and `npm run lint`: no errors.

## Decisions / gaps
- Dedup is in-memory per roster process. Re-answering an item is already refused, so duplicates are a safety net; tested on the ledger directly.
- The PM rule also applies to `answer_item` watcher nudges; the old test expecting one was updated.
- No click-through: no UI change.
