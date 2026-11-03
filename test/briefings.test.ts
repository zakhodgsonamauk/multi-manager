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
  'project-manager': [
    /^# Multi-Manager: Project manager/m, /one per project/i, /launched by the front desk/i, /launch_architect/, /never build/i,
    /set_project_rules/, /stop_architect/, /never approve a sign-off/i, /watcher_nudge/, /\/multi-manager:pm-intake/, /overlap/i,
    /CronCreate/, /3-59\/10 \* \* \* \*/, /PAUSE item/, /report_paused/, /verbatim/, /never restart an architect/i,
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
    assert.ok(text.length < 7500, `${role}.md is ${text.length} characters`);
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

test('the architect deletes its tick job before report_paused', () => {
  const text = read('architect');
  const pause = text.slice(text.indexOf('On a PAUSE item'));
  assert.ok(pause.indexOf('CronDelete') < pause.indexOf('report_paused'));
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
  const notTools = new Set(['claude_session_id', 'to_model', 'watcher_nudge', 'session_id', 'at_least', 'recommended_action']);
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
      if (notTools.has(m[1])) continue;
      assert.ok(tools.has(m[1]), `${file} names \`${m[1]}\`, which is not a registered roster tool`);
    }
  }
});
