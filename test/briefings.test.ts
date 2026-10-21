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
  ],
  architect: [
    /^# Multi-Manager: Architect/m,
    /one workstream/i,
    /conductor\//,
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
  ],
  developer: [
    /^# Multi-Manager: Developer/m, /only on (that|your) slice/i, /worktree/i, /never merge/i, /push/i, /raise_item/,
    /PAUSE item/, /commit WIP/, /resume note/, /report_paused/, /never full suites/, /relayed decision/i,
  ],
};

for (const [role, patterns] of Object.entries(required)) {
  test(`${role} briefing covers its R6 duties and stays tight`, () => {
    const text = read(role);
    for (const pattern of patterns) assert.match(text, pattern, `${role}.md is missing ${pattern}`);
    // 5000, up from 4000: room for pause/resume duties and the user's working style (field report 2026-10-21).
    assert.ok(text.length < 5000, `${role}.md is ${text.length} characters`);
  });
}
