import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalPluginDir, pluginCopyWarning } from '../src/launch/plugin-copy.ts';
import { tempDir } from './helpers.ts';

const CANON = 'C:\\dev\\multi-manager';
const DROPBOX = 'I:\\Dropbox (Personal)\\Projects\\multi-manager';

test('non-canonical folder gets a one-line warning naming the right folder', () => {
  const w = pluginCopyWarning(DROPBOX, CANON);
  assert.ok(w);
  assert.ok(!w.includes('\n'));
  assert.ok(w.includes(CANON) && w.includes(DROPBOX));
});

test('canonical folder gets no warning (case, slash and trailing slash ignored)', () => {
  assert.equal(pluginCopyWarning(CANON, CANON), null);
  assert.equal(pluginCopyWarning('c:/dev/multi-manager/', CANON), null);
});

test('no canonical folder recorded: no warning', () => {
  assert.equal(pluginCopyWarning(DROPBOX, null), null);
});

test('canonical folder comes from env first, then the file, else null', (t) => {
  const home = tempDir(t);
  assert.equal(canonicalPluginDir({ MM_HOME: home }), null);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'canonical-plugin-dir'), `${CANON}\r\n`);
  assert.equal(canonicalPluginDir({ MM_HOME: home }), CANON);
  assert.equal(canonicalPluginDir({ MM_HOME: home, MM_CANONICAL_PLUGIN_DIR: 'X:\\y' }), 'X:\\y');
});
