import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import type { Env } from '../roster/db.ts';

/** Where the one folder Multi-Manager should run from is recorded: a one-line text file next to the roster. */
export function canonicalFilePath(env: Env = process.env): string {
  return join(env.MM_HOME ?? join(homedir(), '.claude', 'multi-manager'), 'canonical-plugin-dir');
}

/** The canonical plugin folder: MM_CANONICAL_PLUGIN_DIR wins, else the first line of the file. Null when none is recorded. */
export function canonicalPluginDir(env: Env = process.env): string | null {
  const fromEnv = env.MM_CANONICAL_PLUGIN_DIR?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(canonicalFilePath(env), 'utf8').split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

function same(a: string, b: string): boolean {
  const norm = (p: string) => win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** One-line warning when running from a folder other than the canonical one; null when it matches or none is recorded. */
export function pluginCopyWarning(running: string, canonical: string | null): string | null {
  if (canonical === null || same(running, canonical)) return null;
  return `Multi-Manager is running from ${running}; the one copy to use is ${canonical}. Start from there.`;
}
