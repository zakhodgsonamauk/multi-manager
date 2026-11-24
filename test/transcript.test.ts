import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseTranscript, readTranscriptInfo } from '../src/monitor/transcript.ts';
import { tempDir } from './helpers.ts';

const line = (o: unknown): string => JSON.stringify(o);
const assistant = (ts: string, usage: Record<string, number>): string =>
  line({ type: 'assistant', timestamp: ts, message: { role: 'assistant', usage } });
const turn = (ts: string, origin: string): string => line({ type: 'user', timestamp: ts, turnOrigin: origin, message: { role: 'user', content: 'x' } });
const toolResult = (ts: string): string => line({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result' }] } });

test('context size is the latest assistant call: input + cache read + cache write', () => {
  const text = [
    turn('2026-01-01T10:00:00Z', 'human'),
    assistant('2026-01-01T10:00:05Z', { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }),
    assistant('2026-01-01T10:00:09Z', { input_tokens: 3, cache_creation_input_tokens: 20, cache_read_input_tokens: 400, output_tokens: 5 }),
  ].join('\n');
  assert.equal(parseTranscript(text).contextTokens, 423);
});

test('empty transcript gives no context size and no activity', () => {
  assert.deepEqual(parseTranscript(''), { contextTokens: null, lastOwnActivityMs: null });
});

test('a missing file gives null, a garbled line is skipped', (t) => {
  const dir = tempDir(t);
  assert.equal(readTranscriptInfo(join(dir, 'nope.jsonl')), null);
  const file = join(dir, 'a.jsonl');
  writeFileSync(file, `not json\n${assistant('2026-01-01T10:00:00Z', { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 })}\n`);
  assert.equal(readTranscriptInfo(file)?.contextTokens, 3);
});

test('a timer check-in turn and its replies do not count as the session own activity', () => {
  const text = [
    turn('2026-01-01T10:00:00Z', 'human'),
    assistant('2026-01-01T10:00:05Z', { input_tokens: 1 }),
    turn('2026-01-01T12:00:00Z', 'scheduled'),
    assistant('2026-01-01T12:00:03Z', { input_tokens: 1 }),
    toolResult('2026-01-01T12:00:04Z'),
    assistant('2026-01-01T12:00:08Z', { input_tokens: 1 }),
  ].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T10:00:05Z'));
});

test('a message from another session after a timer turn counts again', () => {
  const text = [
    turn('2026-01-01T12:00:00Z', 'scheduled'),
    assistant('2026-01-01T12:00:03Z', { input_tokens: 1 }),
    turn('2026-01-01T13:00:00Z', 'peer'),
    assistant('2026-01-01T13:00:09Z', { input_tokens: 1 }),
  ].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T13:00:09Z'));
});

test('a message from another session with no turnOrigin starts the own turn, and the work after it counts', () => {
  // The pattern of real transcripts: a timer turn, then a plain user line (no turnOrigin) such as "Task 281 is done", then tool calls.
  const text = [
    turn('2026-01-01T12:00:00Z', 'scheduled'),
    assistant('2026-01-01T12:00:03Z', { input_tokens: 1 }),
    line({ type: 'user', timestamp: '2026-01-01T12:30:00Z', message: { role: 'user', content: 'Task 281 is done' } }),
    assistant('2026-01-01T12:30:05Z', { input_tokens: 1 }),
    toolResult('2026-01-01T12:31:00Z'),
    assistant('2026-01-01T12:31:09Z', { input_tokens: 1 }),
  ].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T12:31:09Z'));
});

test('a meta line or a tool result with no origin does not start an own turn inside a timer turn', () => {
  const text = [
    turn('2026-01-01T10:00:00Z', 'human'),
    assistant('2026-01-01T10:00:05Z', { input_tokens: 1 }),
    turn('2026-01-01T12:00:00Z', 'scheduled'),
    line({ type: 'user', timestamp: '2026-01-01T12:00:02Z', isMeta: true, message: { role: 'user', content: 'reminder' } }),
    line({ type: 'user', timestamp: '2026-01-01T12:00:03Z', toolUseResult: {}, message: { role: 'user', content: [{ type: 'tool_result' }] } }),
    assistant('2026-01-01T12:00:08Z', { input_tokens: 1 }),
  ].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T10:00:05Z'));
});

test('a transcript larger than the 6 MB tail is read from its end', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'big.jsonl');
  const filler = line({ type: 'assistant', timestamp: '2026-01-01T09:00:00Z', message: { usage: { input_tokens: 5 }, content: 'x'.repeat(1000) } });
  const count = Math.ceil((7 * 1024 * 1024) / (filler.length + 1));
  const head = Array.from({ length: count }, () => filler).join('\n');
  const tail = [turn('2026-01-01T12:00:00Z', 'human'), assistant('2026-01-01T12:00:05Z', { input_tokens: 2, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 })].join('\n');
  writeFileSync(file, `${head}\n${tail}\n`);
  const info = readTranscriptInfo(file);
  assert.equal(info?.contextTokens, 1002);
  assert.equal(info?.lastOwnActivityMs, Date.parse('2026-01-01T12:00:05Z'));
});

const prompt = (ts: string, extra: Record<string, unknown>, text: string): string =>
  line({ type: 'user', timestamp: ts, ...extra, message: { role: 'user', content: text } });
const PANEL = { origin: { kind: 'plugin', name: 'multi-manager' }, turnOrigin: 'system' };
const OWN_AT = Date.parse('2026-01-01T10:00:05Z');
const base = [turn('2026-01-01T10:00:00Z', 'human'), assistant('2026-01-01T10:00:05Z', { input_tokens: 1 })];
const TICK_TEXT = '<command-message>multi-manager:tick</command-message>';

test('a check-in turn the panel started (origin plugin multi-manager) is not the session own activity', () => {
  const text = [
    ...base,
    prompt('2026-01-01T12:00:00Z', PANEL, 'anything at all'),
    assistant('2026-01-01T12:00:03Z', { input_tokens: 1 }),
    toolResult('2026-01-01T12:00:04Z'),
    prompt('2026-01-01T13:00:00Z', {}, 'The Multi-Manager check-in is due. Run the multi-manager:tick command now.'),
    assistant('2026-01-01T13:00:03Z', { input_tokens: 1 }),
  ].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, OWN_AT);
});

test('a person typing the tick command is still the session own activity', () => {
  const text = [prompt('2026-01-01T12:00:00Z', { turnOrigin: 'human' }, '/multi-manager:tick'), assistant('2026-01-01T12:00:03Z', { input_tokens: 1 })].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T12:00:03Z'));
});

test('real line shapes that only MENTION the tick count as the session own work', () => {
  const mentions = [
    // a compaction summary in the middle of a turn
    { extra: { isCompactSummary: true, isMeta: false }, text: `Summary: the check-in ${TICK_TEXT} ran earlier` },
    // a task notification
    { extra: { turnOrigin: 'task_notification' }, text: `${TICK_TEXT} finished` },
    // a meta line
    { extra: { isMeta: true }, text: `${TICK_TEXT}` },
    // a message from another session that quotes the tick
    { extra: { turnOrigin: 'peer' }, text: 'please run multi-manager:tick and check roster item #4' },
    // a message with no origin that merely contains the command name
    { extra: {}, text: 'I looked at /multi-manager:tick and it is fine' },
  ];
  for (const m of mentions) {
    const text = [...base, prompt('2026-01-01T12:00:00Z', m.extra, m.text), assistant('2026-01-01T12:00:09Z', { input_tokens: 1 })].join('\n');
    // a plain (not-own) line before it must not hide that the 12:00 work is the session's
    assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T12:00:09Z'), JSON.stringify(m.extra));
  }
});

test('work after a compaction summary inside a panel check-in turn: the summary does not start a new own turn but also is not a check-in start', () => {
  const text = [
    ...base,
    prompt('2026-01-01T12:00:00Z', {}, 'real work request'),
    assistant('2026-01-01T12:00:03Z', { input_tokens: 1 }),
    prompt('2026-01-01T12:10:00Z', { isCompactSummary: true }, `Summary mentioning ${TICK_TEXT}`),
    assistant('2026-01-01T12:10:09Z', { input_tokens: 1 }),
  ].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T12:10:09Z'));
});

test('an item addressed to the manager after a panel check-in starts its own turn again', () => {
  const text = [
    prompt('2026-01-01T12:00:00Z', PANEL, TICK_TEXT),
    assistant('2026-01-01T12:00:03Z', { input_tokens: 1 }),
    turn('2026-01-01T13:00:00Z', 'peer'),
    assistant('2026-01-01T13:00:09Z', { input_tokens: 1 }),
  ].join('\n');
  assert.equal(parseTranscript(text).lastOwnActivityMs, Date.parse('2026-01-01T13:00:09Z'));
});
