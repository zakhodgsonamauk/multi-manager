import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Env } from '../roster/db.ts';

/** Same content as conductor/tracks/core_20261021/spike/multi-manager.json. */
export const FRAGMENT = {
  profiles: [{ name: 'Multi-Manager', commandline: 'cmd.exe', closeOnExit: 'always', suppressApplicationTitle: true }],
};

export function fragmentPath(env: Env = process.env): string {
  const base = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return join(base, 'Microsoft', 'Windows Terminal', 'Fragments', 'multi-manager', 'multi-manager.json');
}

export function ensureTerminalProfile(env: Env = process.env): { path: string; written: boolean } {
  const path = fragmentPath(env);
  const content = `${JSON.stringify(FRAGMENT, null, 2)}\n`;
  try {
    if (readFileSync(path, 'utf8') === content) return { path, written: false };
  } catch {
    // not installed yet
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { path, written: true };
}
