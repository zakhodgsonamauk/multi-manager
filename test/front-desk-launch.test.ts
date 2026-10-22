import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterDbPath, frontDeskCommand } from '../src/launch/front-desk-launch.ts';
import { resolveDbPath } from '../src/roster/db.ts';

test('clusterDbPath nests the roster inside the cluster folder', () => {
  assert.equal(clusterDbPath('C:\\work\\alpha'), 'C:\\work\\alpha\\.multi-manager\\roster.db');
});

test('the front desk command opens the chosen folder as its own cluster', () => {
  const { file, args, env } = frontDeskCommand({ folder: 'C:\\work\\alpha', pluginDir: 'D:\\mm', wtPath: 'wt.exe', remote: false });
  assert.equal(file, 'wt.exe');
  const d = args[args.indexOf('-d') + 1];
  const pluginDir = args[args.indexOf('--plugin-dir') + 1];
  assert.equal(d, 'C:\\work\\alpha');
  assert.equal(pluginDir, 'D:\\mm');
  assert.ok(args.includes('/multi-manager:front-desk'));
  assert.ok(!args.includes('--remote-control'));
  assert.equal(env.MM_ROSTER_DB, 'C:\\work\\alpha\\.multi-manager\\roster.db');
});

test('remote control adds the --remote-control flag', () => {
  const { args } = frontDeskCommand({ folder: 'C:\\work\\alpha', pluginDir: 'D:\\mm', wtPath: 'wt.exe', remote: true });
  assert.equal(args[args.indexOf('--remote-control') + 1], 'mm-front-desk');
});

test('two folders yield two different roster DBs (isolation)', () => {
  const a = frontDeskCommand({ folder: 'C:\\work\\alpha', pluginDir: 'D:\\mm', wtPath: 'wt.exe', remote: false });
  const b = frontDeskCommand({ folder: 'C:\\work\\beta', pluginDir: 'D:\\mm', wtPath: 'wt.exe', remote: false });
  assert.notEqual(a.env.MM_ROSTER_DB, b.env.MM_ROSTER_DB);
  assert.equal(resolveDbPath({ MM_ROSTER_DB: a.env.MM_ROSTER_DB }), a.env.MM_ROSTER_DB);
  assert.equal(resolveDbPath({ MM_ROSTER_DB: b.env.MM_ROSTER_DB }), b.env.MM_ROSTER_DB);
});
