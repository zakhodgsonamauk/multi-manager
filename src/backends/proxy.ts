// One shared translator program (litellm) for strata. Started when the first session needs it, stopped when the
// last session using it has stopped. State lives in one small file in the roster folder: pid, port, program
// image name, and the SET of session ids using it.
//
// ONE Multi-Manager process owns the state file. Calls from that process are run one after another through an
// in-process promise chain (`locked`), so overlapping acquire/release/reconcile cannot start two proxies or
// lose a user. Two Multi-Manager processes sharing one roster folder are not supported.
// Task 033's launcher calls acquireProxy / releaseProxy; its monitor calls reconcileProxy with the live sessions.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { basename, join } from 'node:path';
import { STRATA_URL } from './definitions.ts';

export const PROXY_STATE_FILE = 'strata-proxy.json';
export const PROXY_CONFIG_FILE = 'strata-litellm.yaml';
export const PROXY_PORT_FIRST = 47832;
export const PROXY_PORT_LAST = 47841;

interface ProxyState {
  pid: number;
  port: number;
  /** Image name of the program started (lower case), so a reused pid belonging to another program is never killed. */
  image: string;
  users: string[];
}

export interface ProxyProgram {
  command: string;
  /** Arguments for the chosen port. */
  args: (port: number) => string[];
  env?: NodeJS.ProcessEnv;
}

export interface ProxyOptions {
  /** The roster folder (holds the state file and the proxy's log). */
  dir: string;
  program: ProxyProgram;
  firstPort?: number;
  lastPort?: number;
  /** How long to wait for the program to start listening. */
  waitMs?: number;
}

export interface ProxyStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  users: string[];
}

const NONE: ProxyStatus = { running: false, pid: null, port: null, users: [] };

let chain: Promise<unknown> = Promise.resolve();
/** Run `fn` after every earlier locked call has finished (success or failure). */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function stateFile(dir: string): string {
  return join(dir, PROXY_STATE_FILE);
}

function readState(dir: string): ProxyState | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(dir), 'utf8')) as Partial<ProxyState>;
    if (Number.isInteger(s.pid) && Number.isInteger(s.port) && typeof s.image === 'string' && Array.isArray(s.users)) {
      return { pid: s.pid as number, port: s.port as number, image: s.image, users: s.users.map(String) };
    }
  } catch {
    // missing or unreadable: no proxy recorded
  }
  return null;
}

function writeState(dir: string, s: ProxyState): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(dir), JSON.stringify(s));
}

function clearState(dir: string): void {
  rmSync(stateFile(dir), { force: true });
  rmSync(join(dir, PROXY_CONFIG_FILE), { force: true });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function imageOf(command: string): string {
  return basename(command).toLowerCase().replace(/\.exe$/, '');
}

/** The image name of a running pid (lower case, no .exe), or null if unknown. */
function runningImage(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\tasklist.exe`, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const m = String(r.stdout).match(/^"([^"]+)"/m);
      return m ? imageOf(m[1] as string) : null;
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    const name = String(r.stdout).trim();
    return name ? imageOf(name) : null;
  } catch {
    return null;
  }
}

/** Is this pid still the program we started (not some other program that reused the pid)? */
function pidIsOurs(s: ProxyState): boolean {
  if (!pidAlive(s.pid)) return false;
  const img = runningImage(s.pid);
  // ps truncates long names, so on non-Windows accept a prefix match either way.
  return img !== null && (img === s.image || s.image.startsWith(img) || img.startsWith(s.image));
}

function portListening(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/** Kill a process and its children (litellm.exe is only a launcher for the real server). */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`, ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  // The program was started as its own process group leader, so -pid reaches its children too.
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** Stop the recorded proxy (only if the pid is still our program) and forget it. */
function stopRecorded(dir: string, s: ProxyState): void {
  if (pidIsOurs(s)) killTree(s.pid);
  clearState(dir);
}

/** Unlocked status: a recorded proxy that is dead, or alive but not answering, is stopped and cleaned up. */
async function statusInner(dir: string): Promise<ProxyStatus> {
  const s = readState(dir);
  if (!s) return NONE;
  if (pidIsOurs(s) && (await portListening(s.port))) return { running: true, pid: s.pid, port: s.port, users: s.users };
  stopRecorded(dir, s); // a hung proxy is killed, not orphaned
  return NONE;
}

export function proxyStatus(dir: string): Promise<ProxyStatus> {
  return locked(() => statusInner(dir));
}

/**
 * Session `sessionId` needs the proxy. Starts it if none is running, otherwise reuses it. Idempotent per session.
 * On a failed start nothing is left running and no user is recorded.
 */
export function acquireProxy(
  sessionId: string,
  o: ProxyOptions,
): Promise<{ port: number; url: string; pid: number; started: boolean }> {
  return locked(async () => {
    const cur = await statusInner(o.dir);
    const s = readState(o.dir);
    if (cur.running && s) {
      if (!s.users.includes(sessionId)) writeState(o.dir, { ...s, users: [...s.users, sessionId] });
      return { port: s.port, url: `http://127.0.0.1:${s.port}`, pid: s.pid, started: false };
    }

    let port: number | null = null;
    for (let p = o.firstPort ?? PROXY_PORT_FIRST; p <= (o.lastPort ?? PROXY_PORT_LAST); p++) {
      if (await portFree(p)) {
        port = p;
        break;
      }
    }
    if (port === null) throw new Error('no free local port for the translator');

    mkdirSync(o.dir, { recursive: true });
    const log = openSync(join(o.dir, 'strata-proxy.log'), 'a');
    let pid: number | undefined;
    try {
      const child = spawn(o.program.command, o.program.args(port), {
        detached: true,
        stdio: ['ignore', log, log],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...o.program.env },
      });
      const spawnError = new Promise<Error>((resolve) => child.once('error', resolve));
      pid = child.pid;
      child.unref();
      const deadline = Date.now() + (o.waitMs ?? 40000);
      while (Date.now() < deadline) {
        if (await portListening(port)) {
          writeState(o.dir, { pid: pid as number, port, image: imageOf(o.program.command), users: [sessionId] });
          return { port, url: `http://127.0.0.1:${port}`, pid: pid as number, started: true };
        }
        if ((await Promise.race([spawnError, new Promise((r) => setTimeout(() => r(null), 100))])) instanceof Error) break;
        if (pid !== undefined && !pidAlive(pid)) break;
      }
      throw new Error('the translator did not start; see strata-proxy.log in the roster folder');
    } catch (e) {
      if (pid !== undefined) killTree(pid);
      rmSync(join(o.dir, PROXY_CONFIG_FILE), { force: true });
      throw e;
    } finally {
      closeSync(log);
    }
  });
}

/** Keep only `keep` as users; stop the proxy when none are left. */
function setUsers(dir: string, s: ProxyState, keep: string[]): ProxyStatus {
  if (keep.length > 0) {
    if (keep.length !== s.users.length) writeState(dir, { ...s, users: keep });
    return { running: true, pid: s.pid, port: s.port, users: keep };
  }
  stopRecorded(dir, s);
  return NONE;
}

/** Session `sessionId` no longer needs the proxy. Idempotent. Stops the proxy when the last user goes. */
export function releaseProxy(sessionId: string, dir: string): Promise<ProxyStatus> {
  return locked(async () => {
    const s = readState(dir);
    if (!s) return NONE;
    return setUsers(dir, s, s.users.filter((u) => u !== sessionId));
  });
}

/**
 * Drop users that are not in `liveSessionIds` (a crashed session never released); stop the proxy if none are left.
 * Also cleans up a recorded proxy that has died or hung.
 */
export function reconcileProxy(liveSessionIds: readonly string[], dir: string): Promise<ProxyStatus> {
  return locked(async () => {
    const cur = await statusInner(dir);
    const s = readState(dir);
    if (!cur.running || !s) return NONE;
    const live = new Set(liveSessionIds);
    return setUsers(dir, s, s.users.filter((u) => live.has(u)));
  });
}

/** Plain-words problem finding the real litellm program, or its path. */
export function findLitellm(): Promise<{ path: string } | { problem: string }> {
  return new Promise((resolve) => {
    const install = 'python -m pip install "litellm[proxy]"';
    try {
      execFile('python', ['-c', 'import sysconfig; print(sysconfig.get_path("scripts"))'], { timeout: 20000 }, (err, out) => {
        const dir = String(out ?? '').trim();
        const exe = process.platform === 'win32' ? 'litellm.exe' : 'litellm';
        const path = join(dir, exe);
        if (err || !dir) return resolve({ problem: `Python was not found, so litellm cannot be run: install Python, then ${install}` });
        resolve(existsSync(path) ? { path } : { problem: `${exe} not found where Python keeps its programs (${dir}): run ${install}` });
      });
    } catch {
      resolve({ problem: `Python was not found, so litellm cannot be run: install Python, then ${install}` });
    }
  });
}

/** The proxy program for strata: translate the Anthropic format to the OpenAI format Strata speaks. */
export function strataProgram(litellmPath: string, dir: string, model: string, strataUrl = STRATA_URL): ProxyProgram {
  const config = join(dir, PROXY_CONFIG_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    config,
    [
      'model_list:',
      `  - model_name: ${model}`,
      '    litellm_params:',
      `      model: openai/${model}`,
      `      api_base: ${strataUrl}/v1`,
      '      api_key: strata-local',
      'litellm_settings:',
      '  drop_params: true',
      'general_settings:',
      '  master_key: strata-local',
      '',
    ].join('\n'),
  );
  return { command: litellmPath, args: (port) => ['--config', config, '--host', '127.0.0.1', '--port', String(port)] };
}
