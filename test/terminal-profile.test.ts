import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureTerminalProfile, fragmentPath } from '../src/launch/terminal-profile.ts';
import { tempDir } from './helpers.ts';

test('the fragment lives under LOCALAPPDATA', () => {
  assert.equal(
    fragmentPath({ LOCALAPPDATA: 'C:\\L' }),
    join('C:\\L', 'Microsoft', 'Windows Terminal', 'Fragments', 'multi-manager', 'multi-manager.json'),
  );
});

test('ensureTerminalProfile writes a closeOnExit:always profile once', (t) => {
  const env = { LOCALAPPDATA: tempDir(t) };
  const first = ensureTerminalProfile(env);
  assert.equal(first.written, true);
  const fragment = JSON.parse(readFileSync(first.path, 'utf8'));
  assert.deepEqual(fragment, {
    profiles: [{ name: 'Multi-Manager', commandline: 'cmd.exe', closeOnExit: 'always', suppressApplicationTitle: true }],
  });
  assert.equal(ensureTerminalProfile(env).written, false);
});
