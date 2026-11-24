// Backup backends: what each fallback model is, as plain data plus small pure helpers.
// Values are copied from the hand-made launchers in Dropbox (claude-on-box.bat, claude-on-strata.bat,
// multi-model-ai\launch-cc-with-glm.bat). Read only: no key value is ever written here, only the NAME of the
// environment variable a key comes from.

export type BackendName = 'claude' | 'box' | 'strata' | 'glm';
export type Tier = 'haiku' | 'sonnet' | 'opus';

/** The user's order of preference when Claude usage runs out (sign-off #13, Q2). `claude` is the default, not a backup. */
export const DEFAULT_PREFERENCE: readonly BackendName[] = ['glm', 'box', 'strata'];

export const BOX_URL = 'http://100.125.235.75:8800';
export const STRATA_URL = 'http://127.0.0.1:47831';
export const OLLAMA_URL = 'http://localhost:11434';
export const GLM_MODEL = 'glm-5.3:cloud';
export const BOX_KEY_ENV_VAR = 'LEADERGPU_LLM_KEY';

// Same numbers as the .bat files (BOX_* / STRATA_*).
export const MAX_OUTPUT_TOKENS = 32000;
export const OUTPUT_SHARE = 8;
export const COMPACT_MARGIN_SHARE = 16;
export const MIN_CONTEXT = 32768;

/** Where a session reads its key at start-up. Never the value. */
export interface KeySource {
  fromEnvVar: string;
  /** Fall back to the same-named value under HKCU\Environment (a window opened before the key was stored). */
  registryFallback: boolean;
  /** The environment variable the session must set the key into. */
  setAs: 'ANTHROPIC_AUTH_TOKEN';
}

export interface BackendDefinition {
  name: BackendName;
  title: string;
  /** Address Claude Code talks to. null = Anthropic's own (claude), or chosen at start-up (strata: the proxy port). */
  baseUrl: string | null;
  keySource: KeySource | null;
  /** Fixed model name, or null when discovered at check time. */
  model: string | null;
  needsProxy: boolean;
  /** What a person must have in place first. */
  prerequisites: string;
}

export const BACKENDS: Record<BackendName, BackendDefinition> = {
  claude: {
    name: 'claude',
    title: 'Claude subscription',
    baseUrl: null,
    keySource: null,
    model: null,
    needsProxy: false,
    prerequisites: 'Your normal Claude login. Nothing to set up.',
  },
  box: {
    name: 'box',
    title: 'LeaderGPU box',
    baseUrl: BOX_URL,
    keySource: { fromEnvVar: BOX_KEY_ENV_VAR, registryFallback: true, setAs: 'ANTHROPIC_AUTH_TOKEN' },
    model: null,
    needsProxy: false,
    prerequisites: `The private network is connected, the box LLM is running, and the user environment variable ${BOX_KEY_ENV_VAR} holds its key.`,
  },
  strata: {
    name: 'strata',
    title: 'Strata (local model server)',
    baseUrl: null,
    keySource: null,
    model: null,
    needsProxy: true,
    prerequisites:
      'Strata is open with a model loaded at 127.0.0.1:47831, and litellm is installed: python -m pip install "litellm[proxy]".',
  },
  glm: {
    name: 'glm',
    title: 'GLM through Ollama',
    baseUrl: OLLAMA_URL,
    keySource: null,
    model: GLM_MODEL,
    needsProxy: false,
    prerequisites: `Ollama is running on this PC at localhost:11434 and lists ${GLM_MODEL}.`,
  },
};

export function isBackendName(x: string): x is BackendName {
  return Object.hasOwn(BACKENDS, x);
}

/** What readiness discovery found about a backend. */
export interface DiscoveredInfo {
  model: string;
  contextTokens: number;
  /** Overrides the definition's address (strata: the shared proxy's address). */
  baseUrl?: string;
}

export interface Limits {
  maxOutputTokens: number;
  /** What to tell Claude Code as its conversation length, so it compacts before a whole reply no longer fits. */
  compactAt: number;
}

/** Context-margin logic ported from claude-on-box.bat (BOX_COMPACT_*), integer maths as cmd's `set /a`. */
export function computeLimits(contextTokens: number): Limits {
  const ceiling = Math.trunc(contextTokens / OUTPUT_SHARE);
  const maxOutputTokens = Math.min(MAX_OUTPUT_TOKENS, ceiling);
  const compactAt = contextTokens - maxOutputTokens - Math.trunc(contextTokens / COMPACT_MARGIN_SHARE);
  return { maxOutputTokens, compactAt };
}

export interface BackendEnv {
  env: Record<string, string>;
  /** Where the key comes from; null when the backend needs none from the user. */
  keySource: KeySource | null;
}

/**
 * The environment variables a session on this backend needs. The key is never in `env`: it is named in
 * `keySource` so the tab can read it at start-up. `info` is required for box and strata (discovered model and
 * length); glm has fixed values; claude is empty.
 */
export function backendEnv(name: BackendName, tier: Tier, info?: DiscoveredInfo): BackendEnv {
  const def = BACKENDS[name];
  if (name === 'claude') return { env: {}, keySource: null };

  const model = def.model ?? info?.model;
  const baseUrl = info?.baseUrl ?? def.baseUrl;
  if (!model || !baseUrl) throw new Error(`backendEnv(${name}) needs discovered model and address`);
  void tier; // every tier maps to the same model on these backends; kept so a later backend can differ.

  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    // Clearing ANTHROPIC_API_KEY stops a key set elsewhere from competing (as the launchers do).
    ANTHROPIC_API_KEY: name === 'glm' ? 'ollama' : '',
    ANTHROPIC_MODEL: model,
    // One model served, so every tier name resolves to it.
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_FABLE_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    ENABLE_TOOL_SEARCH: 'false',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };

  if (name === 'glm') env.ANTHROPIC_AUTH_TOKEN = 'ollama'; // Ollama's documented dummy token, not a secret.
  if (name === 'strata') env.ANTHROPIC_AUTH_TOKEN = 'strata-local'; // the local proxy checks nothing.

  if (name !== 'glm') {
    if (!info) throw new Error(`backendEnv(${name}) needs discovered limits`);
    const limits = computeLimits(info.contextTokens);
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(limits.compactAt);
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(limits.maxOutputTokens);
  }
  return { env, keySource: def.keySource };
}
