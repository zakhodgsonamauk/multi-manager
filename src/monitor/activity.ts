import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * How recently a Claude Code session did something. Claude Code keeps ~/.claude/sessions/<claude pid>.json
 * (status busy|idle, statusUpdatedAt, sessionId, cwd) and writes its transcript to
 * ~/.claude/projects/<slug>/<sessionId>.jsonl. We never guess the slug rule: the transcript is found by
 * looking for <sessionId>.jsonl in every project folder.
 */
export type ClaudeStatus = 'busy' | 'idle' | 'unknown';

/** Everything the activity signal reads from disk; tests pass fakes. */
export interface ActivityReaders {
  /** Parsed ~/.claude/sessions/<pid>.json, or null if missing or unreadable. */
  readSessionFile: (pid: number) => unknown;
  /** Full path of <sessionId>.jsonl under ~/.claude/projects/*, or null. */
  findTranscript: (sessionId: string) => string | null;
  /** mtime in ms, or null if missing. */
  mtimeMs: (path: string) => number | null;
}

export interface Activity {
  status: ClaudeStatus;
  /** max(transcript mtime, statusUpdatedAt, roster check-in), in ms. */
  last_activity_ms: number;
  claude_session_id: string | null;
  transcript: string | null;
}

const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** Looks for <sessionId>.jsonl in each folder of projectsDir. */
export function findTranscriptIn(projectsDir: string, sessionId: string): string | null {
  if (!SESSION_ID.test(sessionId)) return null;
  let folders: string[];
  try {
    folders = readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const folder of folders) {
    const path = join(projectsDir, folder, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Real readers rooted at claudeHome (default ~/.claude). Transcript paths are cached once found. */
export function realActivityReaders(claudeHome: string = join(homedir(), '.claude')): ActivityReaders {
  const found = new Map<string, string>();
  return {
    readSessionFile: (pid) => {
      try {
        return JSON.parse(readFileSync(join(claudeHome, 'sessions', `${pid}.json`), 'utf8')) as unknown;
      } catch {
        return null;
      }
    },
    findTranscript: (sessionId) => {
      const cached = found.get(sessionId);
      if (cached !== undefined && existsSync(cached)) return cached;
      const path = findTranscriptIn(join(claudeHome, 'projects'), sessionId);
      if (path !== null) found.set(sessionId, path);
      return path;
    },
    mtimeMs: (path) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return null;
      }
    },
  };
}

function field<T>(value: unknown, key: string, type: 'string' | 'number'): T | null {
  if (value === null || typeof value !== 'object') return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === type ? (v as T) : null;
}

/** Pure given its readers. rosterMs is the session's last roster check-in (or registration) time. */
export function readActivity(pid: number | null, rosterMs: number, readers: ActivityReaders): Activity {
  const file = pid === null ? null : readers.readSessionFile(pid);
  const raw = field<string>(file, 'status', 'string');
  const status: ClaudeStatus = raw === 'busy' || raw === 'idle' ? raw : 'unknown';
  const sessionId = field<string>(file, 'sessionId', 'string');
  const transcript = sessionId === null ? null : readers.findTranscript(sessionId);
  const times = [rosterMs, field<number>(file, 'statusUpdatedAt', 'number'), transcript === null ? null : readers.mtimeMs(transcript)];
  const last = Math.max(...times.filter((t): t is number => t !== null && Number.isFinite(t)));
  return { status, last_activity_ms: last, claude_session_id: sessionId, transcript };
}
