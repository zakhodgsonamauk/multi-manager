import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { openRoster } from '../src/roster/db.ts';

export function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

/** A fresh roster in a temp folder, opened through MM_ROSTER_DB as the spec requires. */
export function tempRoster(t: TestContext): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), 'mm-test-'));
  const previous = process.env.MM_ROSTER_DB;
  process.env.MM_ROSTER_DB = join(dir, 'roster.db');
  const db = openRoster();
  t.after(() => {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
    if (previous === undefined) delete process.env.MM_ROSTER_DB;
    else process.env.MM_ROSTER_DB = previous;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return db;
}

export function minutesBefore(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}
