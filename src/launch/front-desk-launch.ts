import { join } from 'node:path';

/**
 * The per-cluster roster DB: <folder>/.multi-manager/roster.db.
 * front-desk-picker.ps1 must keep the same rule (it sets MM_ROSTER_DB to this path).
 */
export function clusterDbPath(folder: string): string {
  return join(folder, '.multi-manager', 'roster.db');
}

export interface FrontDeskOptions {
  folder: string;
  pluginDir: string;
  wtPath: string;
  remote: boolean;
}

/** The exact wt.exe command that opens a cluster front desk, and the env that makes it its own isolated cluster. */
export function frontDeskCommand(opts: FrontDeskOptions): { file: string; args: string[]; env: { MM_ROSTER_DB: string } } {
  const name = 'mm-front-desk';
  const args: string[] = ['-w', 'new', 'new-tab', '--title', name, '-d', opts.folder, 'claude', '-n', name];
  if (opts.remote) args.push('--remote-control', 'mm-front-desk');
  args.push('--plugin-dir', opts.pluginDir, '--dangerously-skip-permissions', '/multi-manager:front-desk');
  return { file: opts.wtPath, args, env: { MM_ROSTER_DB: clusterDbPath(opts.folder) } };
}
