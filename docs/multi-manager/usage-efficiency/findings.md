# Where the usage goes: findings, 2026-11-24

Measured from 1,722 transcript files and 125,661 model calls in `~/.claude/projects` over the last 14 days. The calls, token counts, timestamps and session lengths are measured directly. Dollar figures are estimates at API list-price ratios. Read them as shares of the total, not as the subscription bill. Roles and triggers are classified by script.

Scripts: `measure/extract.js`, `measure/analyze.js`. Baseline data (per-session, names private projects, so kept on this PC only, not in the public repo): `conductor/usage-baseline/`.

## Headline
Usage drains mainly because architects and project managers stay open for many hours carrying very large conversations, and every model call re-reads the whole of it.
- 79% of the estimated cost is re-reading cached conversation: 35 billion tokens in 14 days.
- Estimated total: about $21.4k over 14 days, of which about $11.6k was in the last 3 days. Usage is rising.

## By role (14 days / last 3 days)

| Role | 14 days | Last 3 days |
|---|---|---|
| Architect | 53% | 66% |
| Developer | 19% | 21% |
| Project manager | 12% | 9% |
| Non-Multi-Manager sessions | 12% | 0.5% |
| Front desk | 3% | 3% |

## By model
Opus 73%, Sonnet 16%, Fable 9% (from only 2% of calls), Haiku 0.2%.

## Drivers, biggest first
1. **Large, long-lived manager conversations.**
   - Typical conversation per call: about 380k tokens for architects and about 440k for project managers, often reaching 800k.
   - Architects live up to 80 hours and project managers up to 202 hours.
   - Start-up text is only about 65-70k tokens. The rest is old conversation.
   - Only 65 automatic summaries ran in 14 days.
   - Fix: task 027.
2. **Messages between sessions: 41% (about $8.8k).** These turns include real work. "check roster item #N" nudges alone cost about $1.8k of architect turns. Fix: task 028 (partly), and 026/027 make each turn cheaper.
3. **The check-in timer: 17% (about $3.6k).**
   - 5,831 ticks at about $0.62 each. 89% found nothing to do.
   - An idle architect costs about $3.70 an hour just ticking.
   - One project manager ticked 670 times over 202 hours, about $408.
   - Fix: task 026.
4. **Helper agents: 13.8% (about $3.0k).** About $2.0k of that came from architects. Fix: task 028.
5. **Fable: 9.3% (about $2.0k).** About $1.1k of that came from architects. Fix: task 028.
6. **Start-up text: about 65-70k tokens per session**, re-read on every call.
   - Most of it is not Multi-Manager:
     - the third-party skill lists (about 60% of a 9.5k-token skill list)
     - deferred tool names (about 5.6k tokens)
     - 7 user-level tool connections and about 20 claude.ai connectors
   - Multi-Manager's own role briefing is small: 2.5k-7.3k characters.
   - Fix: task 029, if the user agrees.

## Not significant
- Cache expiry: 1.8%. The 1-hour cache holds.
- Stop-hook continuations: 1.1%.
- Developers: they are short-lived (median 0.3 hours, about 170k context) and are the productive spend.
- Front desk: 3%. Its pane already skips quiet check-ins.

## Other findings
- **Idle auto-stop never fires.** `idle_stop_minutes` is only reported to the front desk, not enforced by code. It covers architects only, and only those with no live goal. A session's own ticks also refresh its "last activity", so it never looks quiet. See `src/roster/tools-health.ts:130-142` and `src/monitor/activity.ts:90`. Fix: tasks 026 and 027.
- **"Other active sessions" line.** It is added to every prompt by the user's own claude-context-sync hook (`C:\dev\claude-context-sync\scripts\conflict-check.mjs:325-328`), not by Multi-Manager. It is about 3k characters per prompt and up to about 19% of a long project manager's conversation.
- **Which plugin copy runs.** The plugin is not installed through the marketplace. It loads with `--plugin-dir` from whichever copy the front desk was started from (`src/roster/server.ts:11`).
  - `mm-front-desk-dev` and the Nuclear Option sessions run the `C:\dev` copy.
  - The opendrift-master and projects front desks, and this project's project manager and architect, run the Dropbox copy.
  - The code is identical today: both copies have the same files and the same uncommitted edits. `C:\dev` is 2 docs-only commits ahead.
