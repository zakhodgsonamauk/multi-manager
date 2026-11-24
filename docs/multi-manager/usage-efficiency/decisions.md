# Decisions

One dated entry per decision, newest last. Never rewrite an old entry. Add a new one that supersedes it.

## 2026-11-24 — Measure from transcripts, not the roster

- Context: The roster's spend and model-use records are empty, because this roster is new today.
- Decision: Measure from the transcript files (`~/.claude/projects`) with a script. Keep the script in `measure/` and the baseline data on this PC only in `conductor/usage-baseline/` (the repo is public and the data names private projects), so that before-and-after can be compared once the changes are in.
- Alternatives: Use the older Dropbox roster's self-reported spend. Rejected because it is self-reported, has gaps, and cannot be split by trigger.
- Who: the architect.

## 2026-11-24 — Order the work by measured savings

- Context: Re-reading long manager conversations is 79% of the estimated cost. Idle timer ticks are 17%.
- Decision: Run the tasks in this order:
  - 026: quiet check-ins with no model turn. Biggest certain saving, and simplest.
  - 027: fresh restarts for big, idle managers, plus an idle auto-stop that works.
  - 028: cheaper helper agents, Fable and nudges.
  - 029: smaller start-up text, only if the user agrees.

  026 and 027 run one after the other because they edit the same health code.
- Alternatives:
  - Raise the timer to 30 or 60 minutes. Rejected: it only cuts the tick cost by 3-6 times, while code-side checks cut it to near zero.
  - Lower the automatic-summary threshold only. Kept as a safety net inside 027, but only if Claude Code supports it.
- Who: the architect.

## 2026-11-24 — Leave the "Other active sessions" line alone

- Context: The line comes from the user's own claude-context-sync hook, not from this plugin.
- Decision: Out of scope for this workstream. Raised as a question in the sign-off.
- Alternatives: None. Editing another project's hook is not this workstream's job.
- Who: the architect.
