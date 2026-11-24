import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (role: string) => readFileSync(join(import.meta.dirname, '..', 'briefings', `${role}.md`), 'utf8').replace(/\r\n/g, '\n');

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
    /set_code_graph/,
    /may also switch/,
    /swallows check-ins/,
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
    /nudge whoever the item is addressed to/i,
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
    /\/multi-manager:tick/,
    /Check-ins/,
    /Arm no timer/,
    /no check-in starts while paused/,
    /Developers get no tick/,
  ],
  developer: [
    /^# Multi-Manager: Developer/m, /only on your task/i, /worktree/i, /never merge/i, /push/i, /raise_item/,
    /PAUSE item/, /commit WIP/, /resume note/, /report_paused/, /never full suites/, /relayed decision/i,
    /Read the task file first/, /Never touch `main`/, /docs\/multi-manager\/tasks\/NNN-slug\.return\.md/,
    /kind `done` pointing at the report/, /test command with its output lines/, /screenshots/, /gaps/,
    /process caps/i, /never wait for "global quiet"/i, /only your own processes/i, /send-back round/i,
  ],
  'project-manager': [
    /^# Multi-Manager: Project manager/m, /one per project/i, /launched by the front desk/i, /launch_architect/, /never build/i,
    /set_project_rules/, /stop_architect/, /never approve a sign-off/i, /watcher_nudge/, /\/multi-manager:pm-intake/, /overlap/i,
    /Arm no timer/, /PAUSE item/, /report_paused/, /verbatim/, /never restart an architect/i,
    /set_code_graph/, /It is off unless the project's teams will search a large codebase\./, /You decide and log the decision in `decisions\.md`\./,
  ],
};

for (const [role, patterns] of Object.entries(required)) {
  test(`${role} briefing covers its R6 duties and stays tight`, () => {
    const text = read(role);
    for (const pattern of patterns) assert.match(text, pattern, `${role}.md is missing ${pattern}`);
    // 5600, up from 5000: room for the self-armed check-in timer (field report 2026-10-21).
    // 6000, up from 5600: the repo-files-as-source-of-truth section (status, tasks, decisions, progress).
    // The per-goal steps moved into the /multi-manager:* commands; the briefing only points at them.
    // 7500, up from 7000: who-gets-what under a project manager (goal 89).
    // 7000, up from 6000: the task-scoring rubric and the Fable rule (model routing, 2026-10-23).
    // 8000, up from 7500: cheaper-helper model line and the fresh-restart line (task 028).
    assert.ok(text.length < 8000, `${role}.md is ${text.length} characters`);
  });
}

test('pm-intake decides the code search switch when a project gets its first workstream, default off', () => {
  const text = readFileSync(join(import.meta.dirname, '..', 'commands', 'pm-intake.md'), 'utf8');
  assert.match(text, /first workstream/);
  assert.match(text, /set_code_graph/);
  assert.match(text, /default off/i);
});

test('developers arm no check-in timer', () => {
  assert.doesNotMatch(read('developer'), /CronCreate/);
});

test('the architect briefing points at the workflow commands instead of repeating them', () => {
  const text = read('architect');
  assert.doesNotMatch(text, /git merge --squash/);
  assert.doesNotMatch(text, /conductor\//);
});

test('architect and project manager briefings say check-ins are automatic and arm no timer', () => {
  for (const role of ['architect', 'project-manager']) {
    const text = read(role);
    assert.doesNotMatch(text, /CronCreate/, `${role}.md still tells the model to CronCreate`);
    assert.doesNotMatch(text, /3-59\/10/, `${role}.md still has the timer schedule`);
    assert.doesNotMatch(text, /re-arm/i, `${role}.md still tells the model to re-arm a timer`);
    assert.match(text, /Arm no timer/);
  }
});

test('a pause stops work without a timer to delete: the architect is told no check-in starts while paused', () => {
  const pause = read('architect');
  assert.match(pause.slice(pause.indexOf('On a PAUSE item')), /no check-in starts while paused/);
});

test('tick.md sends architects and project managers to manager_digest, and no command arms a timer', () => {
  const tick = readFileSync(join(import.meta.dirname, '..', 'commands', 'tick.md'), 'utf8');
  assert.match(tick, /manager_digest/);
  assert.match(tick, /resume_note_written/);
  assert.doesNotMatch(tick, /self-armed/);
});

test('the project manager briefing is no longer than the architect briefing', () => {
  assert.ok(read('project-manager').length <= read('architect').length);
});

test('every snake_case tool name in a briefing or command is a real roster tool', () => {
  const root = join(import.meta.dirname, '..');
  const server = readFileSync(join(root, 'test', 'server.test.ts'), 'utf8');
  const tools = new Set([...server.slice(server.indexOf('ALL_TOOLS'), server.indexOf('];')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  const files = [
    ...readdirSync(join(root, 'briefings')).map((f) => join(root, 'briefings', f)),
    ...readdirSync(join(root, 'commands')).map((f) => join(root, 'commands', f)),
  ];
  const notTools = new Set(['claude_session_id', 'to_model', 'watcher_nudge', 'session_id', 'item_ids', 'at_least', 'recommended_action', 'refresh_due']);
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
      if (notTools.has(m[1])) continue;
      assert.ok(tools.has(m[1]), `${file} names \`${m[1]}\`, which is not a registered roster tool`);
    }
  }
});

test('the front desk section of tick.md acts from the digest and names front_desk_digest', () => {
  const text = readFileSync(join(import.meta.dirname, '..', 'commands', 'tick.md'), 'utf8').replace(/\r\n/g, '\n');
  const desk = text.slice(text.indexOf('## Front desk'));
  assert.match(desk, /front_desk_digest/);
  assert.match(desk, /Do not call `status` or `team_health` unless/);
  assert.match(desk, /at most three short lines/i);
  // Items the user has been shown are marked seen, so the next digest leaves them out.
  assert.match(desk, /new_items[^\n]*mark_seen/);
  assert.match(desk, /item_ids/);
  // The architect and project-manager sections act from their own digest (manager_digest).
  assert.match(text, /## Architect\n[^\n]*\n- A digest[^\n]*manager_digest/);
  assert.match(text, /Never restart an architect yourself/);
});

test('the front desk tick sends each refresh_due manager its message, once', () => {
  const text = readFileSync(join(import.meta.dirname, '..', 'commands', 'tick.md'), 'utf8').replace(/\r\n/g, '\n');
  const desk = text.slice(text.indexOf('## Front desk'));
  assert.match(desk, /refresh_due: for each entry, `SendMessage` that manager the entry's `message`, once/);
});

test('architect and project-manager briefings name a cheaper model for research helpers and a fresh restart', () => {
  for (const role of ['architect', 'project-manager']) {
    const text = read(role);
    assert.match(text, /Sonnet/, `${role}: research helpers on Sonnet`);
    assert.match(text, /Haiku/, `${role}: plain searching on Haiku`);
    assert.match(text, /`model`/, `${role}: model passed on the Agent tool`);
    assert.match(text, /restarted fresh/i, `${role}: idle restart line`);
    assert.match(text, /`status\.md` and `progress\.md` current/, `${role}: keep files current before idle`);
  }
  assert.match(read('architect'), /single hardest decision/);
});

test('the developer briefing says to report only through done and blocked', () => {
  assert.match(read('developer'), /Report to your architect only through `done` and `blocked`/);
});

test('architect, project manager and developer briefings mention find_skill', () => {
  for (const role of ['architect', 'project-manager', 'developer']) assert.match(read(role), /find_skill/, role);
});
