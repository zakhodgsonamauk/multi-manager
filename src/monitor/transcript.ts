import { closeSync, openSync, readSync, statSync } from 'node:fs';

/**
 * What the monitor reads from a session's transcript (~/.claude/projects/<slug>/<id>.jsonl):
 *  - contextTokens: size of the conversation the model read on its latest call (input + cache read + cache write).
 *  - lastOwnActivityMs: time of the last line that is not part of a timer check-in turn. Claude Code marks a
 *    turn the system started on a schedule with turnOrigin "scheduled"; that turn and the replies and tool
 *    results after it must not keep a session looking busy.
 */
export interface TranscriptInfo {
  contextTokens: number | null;
  lastOwnActivityMs: number | null;
}

/** Only the end of a long transcript is read: the latest call and the latest turns are all that matter. */
export const TAIL_BYTES = 6 * 1024 * 1024;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Fallback only: the OPENING words of a check-in turn the panel starts (the tick command, or the plain prompt it falls back to). */
const CHECK_IN_OPENING = /^\s*(<command-(message|name)>\/?multi-manager:tick|The Multi-Manager check-in is due\.)/;

/**
 * The first line of a turn the Multi-Manager panel (or the timer) started to run a check-in. Matched on the line's
 * origin (the panel's tick is tagged origin {kind: 'plugin', name: 'multi-manager'}); failing that, on the opening words
 * of a plain user line. Compaction summaries, meta lines, task notifications and messages from people or other sessions
 * are never check-in starts, however they quote the tick.
 */
function isCheckInStart(o: Record<string, unknown>): boolean {
  const from = o.origin as { kind?: unknown; name?: unknown } | undefined;
  if (from?.kind === 'plugin' && from.name === 'multi-manager') return true;
  if (o.isMeta === true || o.isCompactSummary === true || o.turnOrigin === 'human' || o.turnOrigin === 'peer' || o.turnOrigin === 'task_notification') return false;
  if (typeof o.turnOrigin === 'string' && o.turnOrigin !== 'system') return false;
  const content = (o.message as { content?: unknown } | undefined)?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) && (content[0] as { type?: unknown } | undefined)?.type === 'text' ? String((content[0] as { text?: unknown }).text) : '';
  return CHECK_IN_OPENING.test(text);
}

function isToolResult(o: Record<string, unknown>): boolean {
  const content = (o.message as { content?: unknown } | undefined)?.content;
  return o.toolUseResult !== undefined || (Array.isArray(content) && content.length > 0 && content.every((c) => (c as { type?: string } | null)?.type === 'tool_result'));
}

/** Pure: parses transcript text (JSON lines). Lines that are not JSON are skipped. */
export function parseTranscript(text: string): TranscriptInfo {
  let contextTokens: number | null = null;
  let lastOwn: number | null = null;
  // The origin of the turn we are inside. Unknown (the tail began mid-turn) counts as the session's own.
  let origin = 'unknown';
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    if (o.isSidechain === true) continue;
    if (o.type === 'user') {
      // A check-in turn the system started (the timer, or the panel's quiet check that found news) is not the session's own.
      if (isCheckInStart(o)) origin = 'scheduled';
      else if (typeof o.turnOrigin === 'string') origin = o.turnOrigin;
      // A real user line with no origin (a message from another session often has none) starts the session's own turn.
      else if (o.isMeta !== true && !isToolResult(o)) origin = 'own';
    }
    const message = o.message as { usage?: Record<string, unknown> } | undefined;
    if (o.type === 'assistant' && message?.usage !== undefined) {
      const u = message.usage;
      contextTokens = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
    }
    const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (origin !== 'scheduled' && Number.isFinite(at) && (lastOwn === null || at > lastOwn)) lastOwn = at;
  }
  return { contextTokens, lastOwnActivityMs: lastOwn };
}

const cache = new Map<string, { key: string; info: TranscriptInfo }>();

/** Reads the end of a transcript file; null if it is missing or unreadable. Cached while the file is unchanged. */
export function readTranscriptInfo(path: string): TranscriptInfo | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const st = statSync(path);
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = cache.get(path);
    if (hit?.key === key) return hit.info;
    const start = Math.max(0, st.size - TAIL_BYTES);
    const buffer = Buffer.alloc(st.size - start);
    let read = 0;
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    let text = buffer.subarray(0, read).toString('utf8');
    // A tail starts mid-line: drop the partial first line.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    const info = parseTranscript(text);
    cache.set(path, { key, info });
    return info;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
