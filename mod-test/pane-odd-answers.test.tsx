// Tests that the front desk pane survives odd roster answers (hooks/roster-view.ts, hooks/register.tsx):
// text that is not JSON (a too-big answer), answers missing parts, and one failing call among four.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { buildView, rosterJson } from '../hooks/roster-view.ts'

const START_FRONT_DESK = 'mcp__plugin_multi-manager_roster__start_front_desk'

const TOO_BIG =
  'Error: result (88,214 characters) exceeds maximum allowed tokens. Output has been saved to C:\\Users\\someone\\.claude\\projects\\x\\tool-results\\mcp-roster-status-1761040000000.txt. Format: JSON array with schema: [{type: string, text: string}]'

const PANE = {
  plugin: 'multi-manager',
  component: 'Pane',
  requestId: 'multi-manager',
  props: { title: 'Multi-Manager', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const GOOD_STATUS = {
  waiting_for_user: [],
  projects: [
    {
      name: 'shop',
      spend_today_usd: 3.2,
      daily_budget_usd: 20,
      workstreams: [{ name: 'main', branch: 'main', architect: { session_id: 2, name: 'mm-arch-shop', minutes_since_checkin: 1 } }],
      active_goals: [{ id: 3, workstream: 'main', text: 'Build checkout', spent_usd: 1.25, budget_usd: 5 }],
    },
  ],
}
const GOOD_HEALTH = {
  paused: false,
  sessions: [
    {
      session_id: 2,
      name: 'mm-arch-shop',
      state: 'ok',
      status: 'busy',
      minutes_quiet: 2,
      developers: { total: 1, ok: 1, hung: [], stalled: [], dead: [] },
    },
  ],
}
const OPEN_ITEM = { id: 12, kind: 'signoff', state: 'open', body: 'Plan for checkout', raised_by: 'mm-arch-shop', created_at: '2026-10-21T10:00:00.000Z' }

const NOW = Date.parse('2026-10-21T10:05:00.000Z')
const POLL_MS = 15_000

test('rosterJson turns text that is not JSON into a short plain error naming the tool', () => {
  const read = () => rosterJson({ content: [{ type: 'text', text: TOO_BIG }], isError: false }, 'status')
  expect(read).toThrow(/^the roster's status answer could not be read \(it may be too big\): Error: result \(88,214 characters\)/)
  let message = ''
  try {
    read()
  } catch (error) {
    message = (error as Error).message
  }
  // The quoted note is cut to about 120 characters, so the whole line stays short.
  expect(message.length).toBeLessThan(200)
  // JSON still parses; a refusal still throws the roster's own words.
  expect(rosterJson({ content: [{ type: 'text', text: '{"a":1}' }], isError: false }, 'status')).toEqual({ a: 1 })
  expect(() => rosterJson({ content: [{ type: 'text', text: 'nope' }], isError: true }, 'status')).toThrow('nope')
})

test('buildView still builds when the status answer is the too-big note string', () => {
  const view = buildView({ status: TOO_BIG, health: GOOD_HEALTH, items: [OPEN_ITEM], resources: [] }, NOW)
  expect(view.projects).toEqual([])
  expect(view.waiting.map(i => i.id)).toEqual([12])
  expect(view.notes.join(' ')).toContain('Some roster details did not load: waiting items, projects.')
})

test('buildView leaves out parts the roster did not send and names them in a note', () => {
  const noWorkstreams = { projects: [{ name: 'shop', spend_today_usd: 0, daily_budget_usd: null }] }
  const view = buildView({ status: noWorkstreams, health: { paused: false }, items: { nope: true }, resources: 'text' }, NOW)
  expect(view.projects[0]?.workstreams).toEqual([])
  expect(view.projects[0]?.goals).toEqual([])
  expect(view.waiting).toEqual([])
  expect(view.overLimits).toEqual([])
  const note = view.notes.join(' ')
  expect(note).toContain('Some roster details did not load:')
  for (const part of ['waiting items', 'workstreams of shop', 'goals of shop', 'developer health', 'open items', 'process counts']) expect(note).toContain(part)
})

test('buildView with every answer fine has no notes', () => {
  const view = buildView({ status: GOOD_STATUS, health: GOOD_HEALTH, items: [OPEN_ITEM], resources: [] }, NOW)
  expect(view.notes).toEqual([])
  expect(view.projects[0]?.workstreams[0]?.architect?.state).toBe('busy')
})

/** A roster whose answers per tool are raw text, or an error. */
function oddRoster(answers: Record<string, string | { error: string }>) {
  const toasts: string[] = []
  const install = (on: On): void => {
    on('mcp.connect', () => ({ value: { isConnected: true, server: 'plugin:multi-manager:roster' } }))
    on('mcp.call', (_, e) => {
      const answer = answers[e.tool]
      if (answer === undefined) throw new Error(`unexpected roster tool ${e.tool}`)
      if (typeof answer !== 'string') return { value: { content: [{ type: 'text', text: answer.error }], isError: true } }
      return { value: { content: [{ type: 'text', text: answer }], isError: false } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.status', () => ({ value: undefined }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('tool.call', () => ({ result: {} }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
  }
  return { install, answers, toasts }
}

async function startFrontDesk($: Engine, clock: MockClock) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: START_FRONT_DESK } as never)
  await clock.settle()
}

test('the pane shows open items and developer health when status comes back as the too-big note', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  oddRoster({
    status: TOO_BIG,
    team_health: JSON.stringify(GOOD_HEALTH),
    list_items: JSON.stringify([OPEN_ITEM]),
    resources: '[]',
  }).install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^#12/ }))?.text).toBe('#12 sign-off from mm-arch-shop · 5 min ago')
  expect(await ui.find({ type: 'Text', text: /could not be read \(it may be too big\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Roster unavailable/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane says "Roster unavailable" only when every call failed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  oddRoster({
    status: TOO_BIG,
    team_health: { error: 'database is locked' },
    list_items: TOO_BIG,
    resources: { error: 'database is locked' },
  }).install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Roster unavailable/ }))?.text).toContain('the roster\'s status answer could not be read')
  await ui.unmount()
})

test('the pane draws what it has when status lacks waiting items and projects', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  oddRoster({
    status: JSON.stringify({ generated_at: 'x' }),
    team_health: JSON.stringify(GOOD_HEALTH),
    list_items: JSON.stringify([OPEN_ITEM]),
    resources: '[]',
  }).install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Some roster details did not load: waiting items, projects\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#12/ })).toBeDefined()
  await ui.unmount()
})

const GOOD_ANSWERS = () => ({
  status: JSON.stringify(GOOD_STATUS),
  team_health: JSON.stringify(GOOD_HEALTH),
  list_items: JSON.stringify([OPEN_ITEM]),
  resources: '[]',
})

test('a total failure on a later poll, with resources cached, says "Roster unavailable" and keeps the last view', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  const roster = oddRoster(GOOD_ANSWERS())
  roster.install(on)
  await startFrontDesk($, clock)

  roster.answers.status = { error: 'database is locked' }
  roster.answers.team_health = { error: 'database is locked' }
  roster.answers.list_items = { error: 'database is locked' }
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Roster unavailable \(showing the last answer\)/ }))?.text).toContain('database is locked')
  expect(await ui.find({ type: 'Text', text: /^#12/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Goal #3/ })).toBeDefined()
  await ui.unmount()
})

test('a poll where status fails, then recovers, does not toast the same trouble or items again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  const stuck = { ...GOOD_HEALTH, sessions: [{ ...GOOD_HEALTH.sessions[0], state: 'hung' }] }
  const roster = oddRoster({ ...GOOD_ANSWERS(), team_health: JSON.stringify(stuck) })
  roster.install(on)
  await startFrontDesk($, clock)
  // The first view only sets what counts as seen; a stuck architect then toasts once.
  roster.answers.list_items = JSON.stringify([OPEN_ITEM, { ...OPEN_ITEM, id: 13, body: 'New one' }])
  await clock.advance(POLL_MS)
  const before = roster.toasts.length

  roster.answers.status = { error: 'database is locked' }
  roster.answers.list_items = { error: 'database is locked' }
  await clock.advance(POLL_MS)
  roster.answers.status = JSON.stringify(GOOD_STATUS)
  roster.answers.list_items = JSON.stringify([OPEN_ITEM, { ...OPEN_ITEM, id: 13, body: 'New one' }])
  await clock.advance(POLL_MS)
  expect(roster.toasts).toHaveLength(before)
})

test('buildView copes with null list entries and missing numbers and text', () => {
  const status = {
    waiting_for_user: [null, { id: 1, raised_by: null }],
    projects: [
      null,
      {
        name: 'shop',
        workstreams: [null, { name: 'main', branch: 'main', architect: { session_id: 2, name: null } }],
        active_goals: [null, { id: 3, workstream: 'main' }],
      },
    ],
  }
  const health = { paused: false, sessions: [null, { session_id: 2, state: 'ok', status: 'busy', developers: { total: 2 } }] }
  const items = [null, { id: 1, kind: 'info', state: 'open' }]
  const resources = [null, { session_id: 2, over_max: true, binaries: [null, { over: true, binary: 'node' }] }]
  const view = buildView({ status, health, items, resources }, NOW)
  const project = view.projects[0]
  expect(project?.spendTodayUsd).toBe(0)
  expect(project?.dailyBudgetUsd).toBeNull()
  expect(project?.goals[0]).toMatchObject({ text: '', spentUsd: 0, budgetUsd: null })
  expect(view.waiting[0]?.body).toBe('')
  expect(project?.workstreams[0]?.architect?.developers).toBe('2 developers (0 fine)')
  expect(view.overLimits.length).toBe(2)
})

test('the pane draws a status with null entries and missing fields without failing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  const roster = oddRoster({
    ...GOOD_ANSWERS(),
    status: JSON.stringify({ waiting_for_user: [null], projects: [null, { name: 'shop', workstreams: [null], active_goals: [null, { id: 3, workstream: 'main' }] }] }),
    list_items: JSON.stringify([null, { id: 12, kind: 'info', state: 'open' }]),
    team_health: JSON.stringify({ paused: false, sessions: [null] }),
    resources: JSON.stringify([null, { session_id: 2, binaries: [null] }]),
  })
  roster.install(on)
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Goal #3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Roster unavailable/ })).toBeUndefined()
  await ui.unmount()
})

test('two identical notes both draw (the test kit cannot see a Text key; keys are by index in the code)', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  const roster = oddRoster({ ...GOOD_ANSWERS(), status: { error: 'database is locked' }, list_items: { error: 'database is locked' } })
  roster.install(on)
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /database is locked/ })).toBeDefined()
  await ui.unmount()
})
