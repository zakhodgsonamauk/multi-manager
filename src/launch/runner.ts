import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Command, SettingsFile } from './command.ts';
import { claudeSessionsDir, findSessionPid, parseTasklistImage, readSessionFile, sessionFileName } from './process.ts';
import { ensureTerminalProfile } from './terminal-profile.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (command: Command) => Promise<RunResult>;

/** Everything the launcher does to the outside world; tests pass fakes. */
export interface LaunchDeps {
  run: Runner;
  writeSettings: (file: SettingsFile) => void;
  waitForPid: (name: string, since: number) => Promise<number | null>;
  findPid: (name: string) => number | null;
  ownsProcess: (pid: number, name: string) => Promise<boolean>;
  ensureTerminalProfile: () => void;
}

/**
 * The environment for anything we start. Drops the calling session's Claude Code variables: a tab that
 * inherits CLAUDE_CODE_CHILD_SESSION (and friends) never registers for cross-session messaging (spike step 3).
 */
export function launchEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$)/.test(key) || key === 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'),
  );
}

/** wt.exe must not get windowsHide: it hides the new Terminal window too (spike step 2). */
export function hidesWindow(file: string): boolean {
  return !/(^|[\\/])wt(\.exe)?$/i.test(file);
}

export const runCommand: Runner = (command) =>
  new Promise((resolve) => {
    const options = { timeout: 60_000, windowsHide: hidesWindow(command.file), env: launchEnv(), encoding: 'utf8' as const };
    execFile(command.file, command.args, options, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stdout, stderr: stderr !== '' ? stderr : (error?.message ?? '') });
    });
  });

export function writeSettingsFile(file: SettingsFile): void {
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, file.content);
}

export interface WaitOptions {
  dir?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForPid(name: string, since: number, options: WaitOptions = {}): Promise<number | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const pid = findSessionPid(name, { since, dir: options.dir });
    if (pid !== null) return pid;
    if (Date.now() >= deadline) return null;
    await delay(options.intervalMs ?? 500);
  }
}

/** True only if <pid>.json names this session and the live process is claude.exe. Guards against pid reuse. */
export async function ownsProcess(pid: number, name: string, dir: string = claudeSessionsDir()): Promise<boolean> {
  const file = readSessionFile(pid, dir);
  if (file === null || sessionFileName(file) !== name) return false;
  const result = await runCommand({ file: 'tasklist', args: ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'] });
  return parseTasklistImage(result.stdout)?.toLowerCase() === 'claude.exe';
}

export function realDeps(): LaunchDeps {
  return {
    run: runCommand,
    writeSettings: writeSettingsFile,
    waitForPid: (name, since) => waitForPid(name, since),
    findPid: (name) => findSessionPid(name),
    ownsProcess: (pid, name) => ownsProcess(pid, name),
    ensureTerminalProfile: () => {
      ensureTerminalProfile();
    },
  };
}
