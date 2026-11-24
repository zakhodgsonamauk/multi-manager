import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ToolContext } from './tools.ts';

/**
 * The middle-man for other plugins' skills. Tabs start with those plugins switched off (so their skill lists
 * are not re-read on every model call); find_skill searches an index of them and load_skill hands back the
 * instructions with the harness's usual preparation already done.
 */

export interface SkillEntry {
  /** Bare name, e.g. `deploy-to-render`. */
  name: string;
  plugin: string;
  kind: 'skill' | 'command';
  description: string;
  /** Absolute path of the SKILL.md or command file. */
  file: string;
  /** The plugin's folder (what ${CLAUDE_PLUGIN_ROOT} means). */
  pluginRoot: string;
}

export interface PluginFolder {
  /** `name@marketplace` as installed. */
  key: string;
  name: string;
  root: string;
}

/** Frontmatter keys (single-line values and |/> block scalars) plus the body after it. */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replaceAll('\r\n', '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(clean);
  if (m === null) return { data: {}, body: clean };
  const data: Record<string, string> = {};
  const lines = (m[1] ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] ?? '');
    if (kv === null) continue;
    let value = (kv[2] ?? '').trim();
    if (/^[|>][+-]?$/.test(value)) {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1] ?? '')) parts.push((lines[++i] ?? '').trim());
      value = parts.join(' ').trim();
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    data[kv[1] ?? ''] = value;
  }
  return { data, body: clean.slice(m[0].length) };
}

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function files(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  } catch {
    return [];
  }
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Every installed plugin's folder, from ~/.claude/plugins/installed_plugins.json. */
export function installedPluginFolders(claudeHome: string = join(homedir(), '.claude')): PluginFolder[] {
  const file = join(claudeHome, 'plugins', 'installed_plugins.json');
  if (!existsSync(file)) return [];
  // A launch must never fail because of this file: any odd shape just means no plugins.
  const out: PluginFolder[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const plugins = parsed !== null && typeof parsed === 'object' ? (parsed as { plugins?: unknown }).plugins : undefined;
    if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
    for (const [key, installs] of Object.entries(plugins)) {
      const first: unknown = Array.isArray(installs) ? installs[0] : undefined;
      const root = first !== null && typeof first === 'object' ? (first as { installPath?: unknown }).installPath : undefined;
      if (typeof root === 'string' && existsSync(root)) out.push({ key, name: key.split('@')[0] ?? key, root });
    }
  } catch {
    return [];
  }
  return out;
}

/** Scan plugin folders for skills/<name>/SKILL.md and commands/*.md. */
export function buildIndex(folders: PluginFolder[]): SkillEntry[] {
  const entries: SkillEntry[] = [];
  for (const { name: plugin, root } of folders) {
    for (const dir of dirs(join(root, 'skills'))) {
      const file = join(root, 'skills', dir, 'SKILL.md');
      if (!existsSync(file)) continue;
      const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
      entries.push({ name: data.name || dir, plugin, kind: 'skill', description: data.description ?? '', file, pluginRoot: root });
    }
    for (const f of files(join(root, 'commands'))) {
      if (!f.endsWith('.md')) continue;
      const file = join(root, 'commands', f);
      const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
      entries.push({ name: f.slice(0, -3), plugin, kind: 'command', description: data.description ?? '', file, pluginRoot: root });
    }
  }
  return entries;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

function score(entry: SkillEntry, query: string): number {
  const q = words(query);
  if (q.length === 0) return 0;
  const name = entry.name.toLowerCase();
  const plugin = entry.plugin.toLowerCase();
  const desc = entry.description.toLowerCase();
  let total = 0;
  for (const w of q) {
    if (name === w) total += 10;
    else if (name.includes(w)) total += 6;
    if (plugin.includes(w)) total += 3;
    if (desc.includes(w)) total += 2;
  }
  return total;
}

export function search(index: SkillEntry[], query: string, limit = 5): SkillEntry[] {
  return index
    .map((entry) => ({ entry, s: score(entry, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((x) => x.entry);
}

const qualified = (e: SkillEntry): string => `${e.plugin}:${e.name}`;

/** Exact `plugin:name`, else a bare name that only one entry has. */
export function resolve(index: SkillEntry[], name: string): { entry?: SkillEntry; suggestions: SkillEntry[] } {
  const wanted = name.trim().toLowerCase().replace(/^\//, '');
  const exact = index.filter((e) => qualified(e).toLowerCase() === wanted);
  if (exact.length === 1) return { entry: exact[0], suggestions: [] };
  const bare = index.filter((e) => e.name.toLowerCase() === wanted);
  if (bare.length === 1) return { entry: bare[0], suggestions: [] };
  return { suggestions: bare.length > 1 ? bare : search(index, wanted.replace(/[:]/g, ' '), 3) };
}

function splitArgs(args: string): string[] {
  return args.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
}

const MAX_SUPPORT_DEPTH = 3;
const MAX_SUPPORT_FILES = 100;

function supportingFiles(dir: string, skip: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    for (const f of files(d)) if (out.length < MAX_SUPPORT_FILES && join(d, f) !== skip) out.push(join(d, f));
    if (depth >= MAX_SUPPORT_DEPTH) return;
    for (const sub of dirs(d)) if (out.length < MAX_SUPPORT_FILES) walk(join(d, sub), depth + 1);
  };
  walk(dir, 0);
  return out.sort();
}

/** The instructions, with plugin-root and argument substitution done, and shell lines marked, never run. */
export function loadSkill(entry: SkillEntry, args = ''): string {
  const { body } = parseFrontmatter(readFileSync(entry.file, 'utf8'));
  const list = splitArgs(args);
  const skillDir = join(entry.file, '..');
  // One pass, function replacers only: nothing inserted (args, paths) is ever expanded again.
  // Numbering is 0-based (Claude Code skills docs: $0 is the first argument, $ARGUMENTS[0] the same).
  // An index with no matching argument stays as written, so awk's $1 survives. A backslash before $ escapes it.
  let used = false;
  let text = body.replace(
    /\\\$(?=\d|ARGUMENTS)|\$\{CLAUDE_PLUGIN_ROOT\}|\$\{CLAUDE_SKILL_DIR\}|\$ARGUMENTS\[(\d+)\]|\$ARGUMENTS|\$(\d+)/g,
    (m: string, bracket?: string, short?: string) => {
      if (m === '\\$') return '$';
      if (m === '${CLAUDE_PLUGIN_ROOT}') return entry.pluginRoot;
      if (m === '${CLAUDE_SKILL_DIR}') return skillDir;
      if (m === '$ARGUMENTS') {
        used = true;
        return args;
      }
      const value = list[Number(bracket ?? short)];
      if (value === undefined) return m;
      used = true;
      return value;
    },
  );
  if (!used && args.trim() !== '') text = `${text.trimEnd()}\n\nARGUMENTS: ${args}`;
  // Shell blocks: fenced ```! blocks and inline !`cmd`. Marked, not run.
  text = text.replace(/```!\n([\s\S]*?)```/g, (_m, cmd: string) => `[SHELL COMMANDS, NOT RUN. Run them yourself if you need their output:]\n\`\`\`\n${cmd}\`\`\``);
  text = text.replace(/!`([^`\n]+)`/g, (_m, cmd: string) => `[SHELL COMMAND, NOT RUN. Run it yourself if you need its output: \`${cmd}\`]`);
  const header = [`# ${qualified(entry)} (${entry.kind}) — follow the instructions below`, `Plugin folder: ${entry.pluginRoot}`];
  const extra = entry.kind === 'skill' ? supportingFiles(skillDir, entry.file) : [];
  const footer = extra.length > 0 ? `\n\nSupporting files (Read them by path when the instructions mention them):\n${extra.map((f) => `- ${f}`).join('\n')}` : '';
  return `${header.join('\n')}\n\n${text.trim()}${footer}\n`;
}

export interface SkillBrokerOptions {
  /** Plugin folders to index; default every installed plugin. */
  folders?: () => PluginFolder[];
}

/** Index cache; rebuilt when a plugin's skills or commands folder (or its own files) changes. */
export class SkillIndex {
  private cache: { signature: string; entries: SkillEntry[] } | null = null;
  private readonly folders: () => PluginFolder[];
  constructor(folders: () => PluginFolder[]) {
    this.folders = folders;
  }

  get(): SkillEntry[] {
    const folders = this.folders();
    const signature = folders
      .map((f) => {
        const skills = join(f.root, 'skills');
        const stamps = dirs(skills).map((d) => mtime(join(skills, d, 'SKILL.md')));
        const commands = join(f.root, 'commands');
        const cmdStamps = files(commands).map((c) => mtime(join(commands, c)));
        return `${f.root}|${mtime(skills)}|${mtime(commands)}|${stamps.join(',')}|${cmdStamps.join(',')}`;
      })
      .join(';');
    if (this.cache === null || this.cache.signature !== signature) this.cache = { signature, entries: buildIndex(folders) };
    return this.cache.entries;
  }
}

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

/** find_skill and load_skill. */
export function registerSkillTools(server: McpServer, ctx: ToolContext, options: SkillBrokerOptions = {}): void {
  const folders = options.folders ?? ((): PluginFolder[] => installedPluginFolders().filter((f) => f.root !== ctx.pluginRoot && basename(f.root) !== 'multi-manager'));
  const index = new SkillIndex(folders);

  server.registerTool(
    'find_skill',
    {
      description: 'Search the skills and commands of installed plugins (manager tabs have most plugins switched off). Returns best matches; then load_skill.',
      inputSchema: { query: z.string().min(1) },
    },
    ({ query }) =>
      guard(() => {
        const hits = search(index.get(), query);
        if (hits.length === 0) return `No skill matches "${query}". Try other words.`;
        return hits.map((e) => ({ name: qualified(e), kind: e.kind, description: e.description }));
      }),
  );

  server.registerTool(
    'load_skill',
    {
      description: 'Return a skill or command\'s instructions (name as find_skill gives it, plugin:name), ready to follow.',
      inputSchema: { name: z.string().min(1), args: z.string().optional() },
    },
    ({ name, args }) =>
      guard(() => {
        const { entry, suggestions } = resolve(index.get(), name);
        if (entry === undefined) {
          const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.map(qualified).join(', ')}?` : ' Try find_skill.';
          throw new Error(`Skill "${name}" not found.${hint}`);
        }
        return loadSkill(entry, args ?? '');
      }),
  );
}
