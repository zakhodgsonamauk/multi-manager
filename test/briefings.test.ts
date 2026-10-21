import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (role: string) => readFileSync(join(import.meta.dirname, '..', 'briefings', `${role}.md`), 'utf8');

const required: Record<string, RegExp[]> = {
  'front-desk': [
    /^# Multi-Manager: Front desk/m,
    /launch_architect/,
    /cross-cutting/i,
    /separately/i,
    /without (messaging|interrupting) architects/i,
    /verbatim/i,
    /answer_item/,
    /check roster item #N/,
    /waiting/i,
    /permission mode/i,
    /--dangerously-skip-permissions/,
    /never headless or background/i,
    /closes fully/i,
    /pause_status/,
    /finish_pause/,
    /force: true/,
    /Nothing left running/,
    /`resume` only when the user says go/,
    /record-only/i,
    /relayed decision/i,
    /CronList/,
    /CronCreate/,
    /3-59\/10 \* \* \* \*/,
    /\/multi-manager:tick/,
    /6\+ days/,
    /CronDelete/,
    /When pausing everything, `CronDelete`/,
    /re-arm/i,
    /set_voice/,
    /restorable_sessions/,
    /Never restart an architect on your own/,
    /restart_architect/,
  ],
  architect: [
    /^# Multi-Manager: Architect/m,
    /one workstream/i,
    /docs\/multi-manager\//,
    /status\.md/,
    /tasks\/NNN-slug\.md/,
    /decisions\.md/,
    /templates\/architect\//,
    /allocate_number/,
    /never picked by hand/,
    /\/multi-manager:plan-goal/,
    /\/multi-manager:dispatch/,
    /\/multi-manager:review-return/,
    /\/multi-manager:wrap-goal/,
    /restart_developer/,
    /Never restart an architect/,
    /verbatim/,
    /plain words/i,
    /progress\.md/,
    /approval rules/i,
    /signoff/,
    /helper agents/i,
    /launch_developer/,
    /register_session/,
    /claim/,
    /report_spend/,
    /talks to you directly/i,
    /check_in/,
    /nudge the front desk/i,
    /high-level plan/i,
    /click-through/i,
    /UI design and flow/i,
    /never headless or background/i,
    /stop_developer/,
    /PAUSE item/,
    /commit WIP/,
    /resume note/,
    /report_paused/,
    /WAIT for the user's go/,
    /recommended default/,
    /dated decision/,
    /never full suites/,
    /screenshots/,
    /record-only/i,
    /relayed decision/i,
    /CronList/,
    /CronCreate/,
    /3-59\/10 \* \* \* \*/,
    /\/multi-manager:tick/,
    /6\+ days/,
    /CronDelete/,
    /PAUSE item: `CronDelete` your tick job first/,
    /re-arm/i,
    /Developers get no timer/,
  ],
  developer: [
    /^# Multi-Manager: Developer/m, /only on your task/i, /worktree/i, /never merge/i, /push/i, /raise_item/,
    /PAUSE item/, /commit WIP/, /resume note/, /report_paused/, /never full suites/, /relayed decision/i,
    /Read the task file first/, /Never touch `main`/, /docs\/multi-manager\/tasks\/NNN-slug\.return\.md/,
    /kind `done` pointing at the report/, /test command with its output lines/, /screenshots/, /gaps/,
    /process caps/i, /never wait for "global quiet"/i, /only your own processes/i, /send-back round/i,
  ],
};

for (const [role, patterns] of Object.entries(required)) {
  test(`${role} briefing covers its R6 duties and stays tight`, () => {
    const text = read(role);
    for (const pattern of patterns) assert.match(text, pattern, `${role}.md is missing ${pattern}`);
    // 5600, up from 5000: room for the self-armed check-in timer (field report 2026-10-21).
    // 6000, up from 5600: the repo-files-as-source-of-truth section (status, tasks, decisions, progress).
    // The per-goal steps moved into the /multi-manager:* commands; the briefing only points at them.
    assert.ok(text.length < 6000, `${role}.md is ${text.length} characters`);
  });
}

test('developers arm no check-in timer', () => {
  assert.doesNotMatch(read('developer'), /CronCreate/);
});

test('the architect briefing points at the workflow commands instead of repeating them', () => {
  const text = read('architect');
  assert.doesNotMatch(text, /git merge --squash/);
  assert.doesNotMatch(text, /conductor\//);
});

test('the architect deletes its tick job before report_paused', () => {
  const text = read('architect');
  const pause = text.slice(text.indexOf('On a PAUSE item'));
  assert.ok(pause.indexOf('CronDelete') < pause.indexOf('report_paused'));
});
