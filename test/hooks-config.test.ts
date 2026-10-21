import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');

interface HookConfig {
  hooks: Record<string, { hooks: { type: string; command: string; args: string[]; timeout: number }[] }[]>;
  modules?: string[];
}

test('hooks.json also names the front desk pane mod (one hooks.json may hold both hooks and modules)', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')) as HookConfig;
  assert.deepEqual(config.modules, ['./register.tsx']);
  assert.ok(existsSync(join(root, 'hooks', 'register.tsx')));
});

test('SessionStart and Stop run our node scripts through CLAUDE_PLUGIN_ROOT', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')) as HookConfig;
  assert.deepEqual(Object.keys(config.hooks).sort(), ['SessionStart', 'Stop']);
  for (const [event, script] of [['SessionStart', 'session-start-hook.ts'], ['Stop', 'stop-hook.ts']]) {
    const hook = config.hooks[event][0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, 'node');
    assert.deepEqual(hook.args, [`\${CLAUDE_PLUGIN_ROOT}/scripts/${script}`]);
    assert.ok(existsSync(join(root, 'scripts', script)));
  }
});
