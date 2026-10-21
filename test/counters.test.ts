import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { allocateNumber } from '../src/roster/counters.ts';
import { openRoster } from '../src/roster/db.ts';
import { addProject } from '../src/roster/projects.ts';
import { tempDir, tempRoster } from './helpers.ts';

test('numbers are unique and increasing per project and kind', (t) => {
  const db = tempRoster(t);
  const alpha = addProject(db, { name: 'alpha', folder: 'C:\\a' });
  addProject(db, { name: 'beta', folder: 'C:\\b' });
  assert.equal(allocateNumber(db, 'alpha', 'task'), 1);
  assert.equal(allocateNumber(db, alpha.id, 'task'), 2);
  assert.equal(allocateNumber(db, 'alpha', 'finding'), 1);
  assert.equal(allocateNumber(db, 'beta', 'task'), 1);
  assert.equal(allocateNumber(db, 'alpha', 'TASK'), 3, 'kinds are case-insensitive');
});

test('atLeast seeds a counter from existing numbers and never goes backwards', (t) => {
  const db = tempRoster(t);
  addProject(db, { name: 'alpha', folder: 'C:\\a' });
  assert.equal(allocateNumber(db, 'alpha', 'finding', { atLeast: 42 }), 42);
  assert.equal(allocateNumber(db, 'alpha', 'finding'), 43);
  assert.equal(allocateNumber(db, 'alpha', 'finding', { atLeast: 10 }), 44);
  assert.throws(() => allocateNumber(db, 'alpha', ' '), /kind is required/);
  assert.throws(() => allocateNumber(db, 'nope', 'task'), /Unknown project/);
});

test('two database handles on the same file never get the same number', (t) => {
  const path = join(tempDir(t), 'roster.db');
  const a = openRoster(path);
  const b = openRoster(path);
  const got: number[] = [];
  try {
    addProject(a, { name: 'alpha', folder: 'C:\\a' });
    for (let i = 0; i < 20; i += 1) got.push(allocateNumber(i % 2 === 0 ? a : b, 'alpha', 'task'));
  } finally {
    a.close();
    b.close();
  }
  assert.deepEqual(got, Array.from({ length: 20 }, (_, i) => i + 1));
});

test('concurrent allocators in separate threads get unique numbers', async (t) => {
  const path = join(tempDir(t), 'roster.db');
  const setup = openRoster(path);
  addProject(setup, { name: 'alpha', folder: 'C:\\a' });
  allocateNumber(setup, 'alpha', 'task'); // creates the counters table before the race
  setup.close();
  const counters = new URL('../src/roster/counters.ts', import.meta.url).href;
  const db = new URL('../src/roster/db.ts', import.meta.url).href;
  const source = `
    const { workerData, parentPort } = await import('node:worker_threads');
    const { openRoster } = await import(${JSON.stringify(db)});
    const { allocateNumber } = await import(${JSON.stringify(counters)});
    const handle = openRoster(workerData.path);
    const out = [];
    for (let i = 0; i < 40; i += 1) out.push(allocateNumber(handle, 'alpha', 'task'));
    handle.close();
    parentPort.postMessage(out);`;
  const run = (): Promise<number[]> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { workerData: { path } });
      worker.once('message', resolve);
      worker.once('error', reject);
    });
  const results = (await Promise.all([run(), run(), run()])).flat();
  assert.equal(new Set(results).size, 120);
  const check = new DatabaseSync(path);
  const next = (check.prepare("SELECT next FROM counters WHERE kind = 'task'").get() as { next: number }).next;
  check.close();
  assert.equal(next, 122);
});
