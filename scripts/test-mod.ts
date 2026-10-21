// Runs the front desk pane mod's tests (mod-test/*.test.tsx) with `claude plugin test`.
//
// `claude plugin test <dir>` runs every *.test.ts(x) under <dir> inside the mod's own environment, which has
// no Node, so pointed at this repo it would also try (and fail) to load the node:test suites in test/.
// Instead this stages the mod alone in a temporary folder: the manifest, the hooks module and what it
// imports, the state contract and the mod tests, then runs the kit there.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const stage = mkdtempSync(join(tmpdir(), 'mm-mod-test-'));
const dir = join(stage, 'multi-manager');

try {
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>;
  // The roster server and the classic hooks are not part of what the mod tests exercise.
  delete manifest.mcpServers;
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2));
  const hooks = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')) as { modules: string[] };
  mkdirSync(join(dir, 'hooks'));
  writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ modules: hooks.modules }, null, 2));
  for (const file of ['register.tsx', 'roster-view.ts']) cpSync(join(root, 'hooks', file), join(dir, 'hooks', file));
  cpSync(join(root, 'types'), join(dir, 'types'), { recursive: true });
  cpSync(join(root, 'mod-test'), join(dir, 'mod-test'), { recursive: true });

  const run = spawnSync('claude', ['plugin', 'test', dir], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
