// Readiness checks for each backup backend. Never throw: any failure becomes { ready: false, note }.
import { execFile } from 'node:child_process';
import { findLitellm } from './proxy.ts';
import { BOX_KEY_ENV_VAR, BOX_URL, GLM_MODEL, MIN_CONTEXT, OLLAMA_URL, STRATA_URL } from './definitions.ts';
import type { BackendName } from './definitions.ts';

export interface Readiness {
  ready: boolean;
  model: string | null;
  contextTokens: number | null;
  note: string;
  /** Box only: /status said the box is reading documents and answering one request at a time. */
  slowed?: boolean;
}

export interface CheckOptions {
  env?: NodeJS.ProcessEnv;
  boxUrl?: string;
  strataUrl?: string;
  ollamaUrl?: string;
  timeoutMs?: number;
  /** Reads a value under HKCU\Environment. Replaceable in tests. */
  readRegistry?: (name: string) => Promise<string | null>;
  /** Replaceable in tests: a plain-words problem if litellm is missing, else null. */
  litellmProblem?: () => Promise<string | null>;
  /** Replaceable in tests: a plain-words problem if the litellm program file is missing, else null. */
  litellmProgramProblem?: () => Promise<string | null>;
}

function fail(note: string, extra: Partial<Readiness> = {}): Readiness {
  return { ready: false, model: null, contextTokens: null, note, ...extra };
}

async function getJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
}

function runFile(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: 20000, windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') }));
    } catch {
      resolve({ ok: false, out: '' });
    }
  });
}

export async function readRegistryValue(name: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const reg = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\reg.exe`;
  const r = await runFile(reg, ['query', 'HKCU\\Environment', '/v', name]);
  if (!r.ok) return null;
  const line = r.out.split(/\r?\n/).find((l) => l.includes(name));
  const m = line?.trim().match(/^\S+\s+\S+\s+(.*)$/);
  return m?.[1]?.trim() || null;
}

/** The key for the box, from the environment or the registry. Used for the request header only, never returned. */
async function boxKey(o: CheckOptions): Promise<string | null> {
  const fromEnv = (o.env ?? process.env)[BOX_KEY_ENV_VAR];
  if (fromEnv) return fromEnv;
  return (o.readRegistry ?? readRegistryValue)(BOX_KEY_ENV_VAR);
}

export async function defaultLitellmProblem(): Promise<string | null> {
  const r = await runFile('python', ['-c', 'import apscheduler, backoff, litellm']);
  return r.ok ? null : 'litellm is not installed: run python -m pip install "litellm[proxy]"';
}

export async function defaultLitellmProgramProblem(): Promise<string | null> {
  const r = await findLitellm();
  return 'problem' in r ? r.problem : null;
}

async function checkBox(o: CheckOptions): Promise<Readiness> {
  const url = o.boxUrl ?? BOX_URL;
  const key = await boxKey(o);
  if (!key) return fail(`the key for the box is not on this PC (set ${BOX_KEY_ENV_VAR})`);
  const headers = { Authorization: `Bearer ${key}` };
  const t = o.timeoutMs ?? 15000;
  try {
    const models = obj(await getJson(`${url}/v1/models`, t, headers));
    const first = obj(Array.isArray(models.data) ? models.data[0] : null);
    const model = typeof first.id === 'string' ? first.id : null;
    const ctx = Number(first.max_model_len);
    const state = obj(await getJson(`${url}/status`, t, headers)).state;
    if (!model || !Number.isFinite(ctx) || ctx <= 0) return fail('the LeaderGPU box answered but is not serving a model');
    const slowed = state === 'slowed';
    const short = ctx < MIN_CONTEXT ? ` (its conversations are only ${ctx} tokens, too short for Claude Code)` : '';
    return {
      ready: ctx >= MIN_CONTEXT,
      model,
      contextTokens: ctx,
      slowed,
      note: slowed
        ? `the LeaderGPU box is slowed: it is reading documents, so answers will be slower${short}`
        : `the LeaderGPU box is ready${short}`,
    };
  } catch {
    return fail('the LeaderGPU box is not reachable');
  }
}

async function checkStrata(o: CheckOptions): Promise<Readiness> {
  const problem = await (o.litellmProblem ?? defaultLitellmProblem)();
  if (problem) return fail(problem);
  const programProblem = await (o.litellmProgramProblem ?? defaultLitellmProgramProblem)();
  if (programProblem) return fail(programProblem);
  const url = o.strataUrl ?? STRATA_URL;
  try {
    const models = obj(await getJson(`${url}/v1/models`, o.timeoutMs ?? 10000));
    const list = Array.isArray(models.data) ? models.data : [];
    // A model counts only when it is actually in memory ("loaded").
    const loaded = list.map(obj).find((m) => obj(m.status).value === 'loaded');
    if (!loaded || typeof loaded.id !== 'string') return fail('Strata is running but no model is loaded: open Strata and load one');
    const ctx = Number(loaded.context_length);
    if (!Number.isFinite(ctx) || ctx <= 0) return fail('Strata did not say how long a conversation its model takes');
    const short = ctx < MIN_CONTEXT;
    return {
      ready: !short,
      model: loaded.id,
      contextTokens: ctx,
      note: short
        ? `Strata's model takes conversations of only ${ctx} tokens, too short for Claude Code: load a larger one`
        : 'Strata is ready',
    };
  } catch {
    return fail('Strata is not reachable: open Strata and load a model');
  }
}

async function checkGlm(o: CheckOptions): Promise<Readiness> {
  const url = o.ollamaUrl ?? OLLAMA_URL;
  try {
    const tags = obj(await getJson(`${url}/api/tags`, o.timeoutMs ?? 10000));
    const names = (Array.isArray(tags.models) ? tags.models : []).map((m) => String(obj(m).name ?? obj(m).model ?? ''));
    if (!names.includes(GLM_MODEL)) return fail(`Ollama is running but does not list ${GLM_MODEL}`);
    return { ready: true, model: GLM_MODEL, contextTokens: null, note: 'Ollama is ready' };
  } catch {
    return fail('Ollama is not running on this PC (localhost:11434)');
  }
}

/** Is this backend ready right now? Never throws. */
export async function checkBackend(name: BackendName, o: CheckOptions = {}): Promise<Readiness> {
  try {
    switch (name) {
      case 'claude':
        return { ready: true, model: null, contextTokens: null, note: 'the Claude subscription needs no check' };
      case 'box':
        return await checkBox(o);
      case 'strata':
        return await checkStrata(o);
      case 'glm':
        return await checkGlm(o);
    }
  } catch (e) {
    return fail(`the check failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`);
  }
}
