# Multi-Manager — Vision and First Rough Plan

Date: 2026-10-21
Status: Vision only. Not yet a design. Prior-art research pending.

## Purpose

Let one person give high-level direction to several projects at once, from a single place.

Multi-Manager is a Claude Code add-on that supports one particular way of working: a single
conversation with the user at the top, fanning out to many projects, each of which fans out to
many builders.

## Shape (first rough plan)

```
                    User
                     │
          ┌──────────┴──────────┐
          │  Front desk (1x)    │   the only Claude Code instance the user talks to
          └──────────┬──────────┘
        ┌────────────┼────────────┐
   ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
   │Architect│  │Architect│  │Architect│   X instances; each owns one project
   │ proj A  │  │ proj B  │  │ proj A' │   (not necessarily different projects)
   └────┬────┘  └────┬────┘  └────┬────┘
     ┌──┼──┐      ┌──┼──┐      ┌──┼──┐
     D  D  D      D  D  D      D  D  D        Y developer instances per architect
```

- **Front desk** — one user-facing Claude Code instance. Takes the user's high-level intent,
  routes it to the right architect(s), and reports back a combined picture of progress.
- **Architects** — X Claude Code instances, one per project (or per workstream; two architects
  may share a project). Each turns intent into a plan for its project and directs its developers.
- **Developers** — Y Claude Code instances per architect. Each does hands-on work on a slice of
  that project.

## Open questions (to settle during brainstorming)

- How the three tiers talk to each other (shared files, a message channel, a tool connection,
  the built-in Claude Code session messaging, something else).
- Whether instances are long-lived sessions or spun up per task.
- Where instances run (all on this Windows machine, terminals, cloud sessions, a mix).
- How the user sees status across all projects without reading every instance's output.
- How much autonomy each tier has before it must ask the tier above.

## Next step

Research existing tools that already support this style of work before designing anything.
