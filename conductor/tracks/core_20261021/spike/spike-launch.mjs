// Usage: node spike-launch.mjs "<scratch folder>" [session-name]
import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const [folder, name = 'mm-spike-main'] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node spike-launch.mjs "<scratch folder>" [session-name]');
  process.exit(2);
}
mkdirSync(folder, { recursive: true });

const settingsPath = join(here, 'spike-settings.json');
writeFileSync(settingsPath, JSON.stringify({
  env: { MM_ROLE: 'architect', MM_SESSION_ID: '9001', MM_PARENT_ID: '9000', MM_ROSTER_DB: join(here, 'spike-roster.db'), MM_VOICE: 'off' },
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: [join(here, 'spike-hook.mjs')] }] }] },
}, null, 2));
const mcpPath = join(here, 'spike-mcp.json');
writeFileSync(mcpPath, JSON.stringify({ mcpServers: { 'spike-env': { command: 'node', args: [join(here, 'spike-env-mcp.mjs')] } } }, null, 2));

const wt = join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe');
const prompt = 'Spike session. Reply with one line saying what your SessionStart hook context reported. Then wait. When another session messages you, reply to it with PONG followed by its text.';
const args = ['-w', 'multi-manager', 'new-tab', '--profile', 'Multi-Manager', '--title', name, '-d', folder,
  'claude', '-n', name, '--dangerously-skip-permissions',
  '--mcp-config', mcpPath,
  '--append-system-prompt-file', join(here, 'spike-briefing.md'),
  '--settings', settingsPath,
  prompt];

// Strip this session's Claude Code variables: a tab that inherits CLAUDE_CODE_CHILD_SESSION etc. never registers for cross-session messaging.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID)/.test(key) || key === 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'));
const started = Date.now();
execFile(wt, args, { timeout: 30_000, env: cleanEnv }, async (error, stdout, stderr) => {
  const result = { wt, args, exit: error ? (error.code ?? 1) : 0, error: error ? error.message : null, stdout, stderr, pid: null, sessionFile: null, candidates: [], waitedMs: 0 };
  const dir = join(homedir(), '.claude', 'sessions');
  // 240 × 500 ms = 120 s: long enough to survive a workspace-trust dialog the human must accept (Task 1.2 Part C).
  for (let attempt = 0; attempt < 240 && result.pid === null; attempt += 1) {
    result.candidates = [];
    for (const file of readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))) {
      try {
        const session = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        result.candidates.push({ file, name: session.name, nameSource: session.nameSource, startedAt: session.startedAt, kind: session.kind });
        if (session.name === name && session.startedAt >= started - 1000) {
          result.pid = session.pid;
          result.sessionFile = session;
        }
      } catch {
        // file being written; try again next round
      }
    }
    if (result.pid === null) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  result.waitedMs = Date.now() - started;
  writeFileSync(join(here, 'spike-launch-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
});
