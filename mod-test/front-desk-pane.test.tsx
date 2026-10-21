// Tests of the front desk pane mod (hooks/register.tsx), run by `npm run test:mod` through `claude plugin test`.
// Nothing sits beneath the plugin: the hooks registered here stand for the engine and the roster MCP server.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const START_FRONT_DESK = 'mcp__plugin_multi-manager_roster__start_front_desk'
const POLL_MS = 15_000

const PANE = {
  plugin: 'multi-manager',
  component: 'Pane',
  requestId: 'multi-manager',
  props: {
    title: 'Multi-Manager',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'multi-manager',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 5,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

type Item = { id: number; kind: string; body: string; raised_by: string | null; created_at: string }

const SIGN_OFF: Item = {
  id: 12,
  kind: 'signoff',
  body: 'Plan for checkout:\n1. Cart page\n2. **Payment** step',
  raised_by: 'mm-arch-shop',
  created_at: '2026-10-21T10:00:00.000Z',
}

/** A roster the test can change between polls; `calls` records every tool call the mod made. */
function fakeRoster(options: { items?: Item[]; busy?: boolean; projects?: boolean } = {}) {
  const roster = {
    items: options.items ?? [SIGN_OFF],
    busy: options.busy ?? true,
    health: 'ok' as 'ok' | 'hung' | 'stalled' | 'dead',
    projects: options.projects ?? true,
    deliver: true,
    calls: [] as { tool: string; args: Record<string, unknown> }[],
    sent: [] as { to: string; text: string }[],
    toasts: [] as string[],
    status: [] as (string | undefined)[],
    prompts: [] as string[],
  }
  const answer = (tool: string, args: Record<string, unknown>): unknown => {
    switch (tool) {
      case 'status':
        return {
          generated_at: '2026-10-21T10:05:00.000Z',
          stale_after_minutes: 30,
          waiting_for_user: roster.items,
          projects: roster.projects
            ? [
                {
                  name: 'shop',
                  folder: 'C:/code/shop',
                  spend_today_usd: 3.2,
                  daily_budget_usd: 20,
                  workstreams: [{ name: 'main', branch: 'main', architect: { session_id: 2, name: 'mm-arch-shop', minutes_since_checkin: 1, stale: false } }],
                  active_goals: [{ id: 3, workstream: 'main', text: 'Build checkout', state: 'active', spent_usd: 1.25, budget_usd: 5 }],
                  open_items: [],
                },
              ]
            : [],
        }
      case 'team_health':
        return {
          paused: false,
          sessions: roster.projects
            ? [
                {
                  session_id: 2,
                  name: 'mm-arch-shop',
                  role: 'architect',
                  state: roster.health,
                  status: roster.busy ? 'busy' : 'idle',
                  minutes_quiet: 2,
                  nudges: 0,
                  recommended_action: 'none',
                  reason: '',
                  developers: { total: 1, ok: 1, hung: [], stalled: [], dead: [] },
                },
              ]
            : [],
        }
      case 'list_items':
        return roster.items.map(i => ({ ...i, raised_by: 2, state: 'open', addressed_to: 1 }))
      case 'resources':
        return roster.projects
          ? [{ session_id: 2, name: 'mm-arch-shop', role: 'architect', process_count: 12, max_processes: 40, over_max: false, binaries: [] }]
          : []
      case 'answer_item':
        return { item: { id: args.item_id, state: 'answered', answer: args.answer }, nudge: { to: 'mm-arch-shop', message: `check roster item #${String(args.item_id)}` } }
      case 'pause':
        return { pause: { id: 1 }, sessions: [{ session_id: 2, name: 'mm-arch-shop', role: 'architect', item_id: 40, nudge: 'check roster item #40' }] }
      default:
        throw new Error(`unexpected roster tool ${tool}`)
    }
  }
  const install = (on: On): void => {
    on('mcp.connect', () => ({ value: { isConnected: true, server: 'plugin:multi-manager:roster' } }))
    on('mcp.call', (_, e) => {
      roster.calls.push({ tool: e.tool, args: e.args })
      return { value: { content: [{ type: 'text', text: JSON.stringify(answer(e.tool, e.args)) }], isError: false } }
    })
    on('session.send', (_, e) => {
      roster.sent.push({ to: e.to, text: e.text })
      return roster.deliver ? { isDelivered: true } : { isDelivered: false, reason: 'nobody by that name' }
    })
    on('prompt.submit', (_, e) => {
      roster.prompts.push(e.text)
      return { text: e.text }
    })
    on('ui.toast', (_, e) => {
      roster.toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.status', (_, e) => {
      roster.status.push(e.text)
      return { value: undefined }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('tool.call', () => ({ result: {} }))
    // The engine's own band, drawn when the mod passes.
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
  }
  const toolCalls = (tool: string) => roster.calls.filter(c => c.tool === tool)
  return { roster, install, toolCalls }
}

/** Starts a session and makes it the front desk the way the briefing does: start_front_desk succeeds. */
async function startFrontDesk($: Engine, clock: MockClock) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: START_FRONT_DESK } as never)
  await clock.settle()
}

test('the pane lists projects, architects and waiting items on terminal and desktop', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:05:00.000Z') })
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^shop/ }))?.text).toContain('spent today $3.20 of $20.00')
    expect((await ui.find({ type: 'Text', text: /^ *main \(branch/ }))?.text).toContain('main (branch main): mm-arch-shop — busy, quiet 2 min, 12 processes (limit 40)')
    expect(await ui.find({ type: 'Text', text: /1 developer \(1 fine\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Goal #3 \(main\): Build checkout · \$1\.25 of \$5\.00/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^#12/ }))?.text).toBe('#12 sign-off from mm-arch-shop · 5 min ago')
    // The body is quoted verbatim: every line kept, behind "> ".
    expect((await ui.find({ type: 'Markdown', key: 'body-12' }))?.text).toBe('> Plan for checkout:\n> 1. Cart page\n> 2. **Payment** step')
    expect(await ui.find({ type: 'Input', key: 'answer-12' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'send-12' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'stop-2' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'mm-pause' })).toBeDefined()
    await ui.unmount()
  }
  // One round of each read tool, nothing written.
  expect(fake.roster.calls.map(c => c.tool).sort()).toEqual(['list_items', 'resources', 'status', 'team_health'])
  expect(fake.toolCalls('list_items')[0]?.args).toEqual({ states: ['open'] })
})

test('Send records the answer exactly as typed and delivers the nudge', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  const typed = '  Yes, go ahead — but keep **v2** of the API.\nThanks  '
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'answer-12', text: typed, kind: 'change' })
    await ui.press({ key: 'send-12' })
    await ui.unmount()
  }
  expect(fake.toolCalls('answer_item').map(c => c.args)).toEqual([
    { item_id: 12, answer: typed },
    { item_id: 12, answer: typed },
  ])
  expect(fake.roster.sent).toEqual([
    { to: 'mm-arch-shop', text: 'check roster item #12' },
    { to: 'mm-arch-shop', text: 'check roster item #12' },
  ])
  expect(fake.roster.prompts).toEqual([])

  // Enter in the field sends too, again verbatim.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'answer-12', text: 'No.' })
  expect(fake.toolCalls('answer_item').at(-1)?.args).toEqual({ item_id: 12, answer: 'No.' })
  // An empty answer is never sent.
  await ui.press({ key: 'send-12' })
  expect(fake.toolCalls('answer_item')).toHaveLength(3)
  expect(fake.roster.toasts).toContain('Type an answer first.')
  await ui.unmount()
})

test('a nudge that cannot be delivered is handed to the front desk as a prompt', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.deliver = false
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'answer-12', text: 'Approved' })
  await ui.unmount()
  expect(fake.toolCalls('answer_item')[0]?.args).toEqual({ item_id: 12, answer: 'Approved' })
  expect(fake.roster.prompts).toHaveLength(1)
  expect(fake.roster.prompts[0]).toContain('to mm-arch-shop: "check roster item #12"')
})

test('on mobile, where there is no text field, quick answers send their word', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.press({ key: 'approve-12' })
  await ui.press({ key: 'reject-12' })
  await ui.unmount()
  expect(fake.toolCalls('answer_item').map(c => c.args)).toEqual([
    { item_id: 12, answer: 'Approve' },
    { item_id: 12, answer: 'Reject' },
  ])
})

test('Pause all asks first, then pauses and nudges every running session', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'mm-pause' })
  expect(fake.toolCalls('pause')).toHaveLength(0)
  await ui.press({ key: 'mm-pause-yes' })
  await ui.unmount()
  expect(fake.toolCalls('pause')).toHaveLength(1)
  expect(fake.roster.sent).toEqual([{ to: 'mm-arch-shop', text: 'check roster item #40' }])
})

test('band and status line stay empty when nothing is waiting, stuck or busy', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster({ items: [], busy: false })
  fake.install(on)
  await startFrontDesk($, clock)

  expect(fake.roster.status.at(-1)).toBeUndefined()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
  }
})

test('band and status line show one plain line when something needs the user', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  expect(fake.roster.status.at(-1)).toBe('MM: 1 sign-off waiting · 1 architect busy')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^MM:/ }))?.text).toBe('MM: 1 sign-off waiting · 1 architect busy ')
    await ui.unmount()
  }
})

test('a toast announces each new item once, polling every 15 seconds', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)
  // What waited when the front desk started is shown by the briefing, not toasted.
  expect(fake.roster.toasts).toEqual([])

  fake.roster.items = [...fake.roster.items, { id: 13, kind: 'question', body: 'Which payment provider?', raised_by: 'mm-arch-shop', created_at: '2026-10-21T10:04:00.000Z' }]
  await clock.advance(POLL_MS)
  expect(fake.roster.toasts).toEqual(['New question from mm-arch-shop: Which payment provider?'])
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  expect(fake.roster.toasts).toHaveLength(1)
  expect(fake.toolCalls('status').length).toBeGreaterThanOrEqual(4)
})

test('a session that is not the front desk draws nothing and asks the roster nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { MM_ROLE: 'architect' })
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)
  await clock.advance(POLL_MS * 3)

  expect(fake.roster.calls).toEqual([])
  expect(fake.roster.toasts).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Text' }))?.text).toContain('front desk session only')
  await pane.unmount()
})

test('a plain session polls nothing until it becomes the front desk', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS * 3)
  expect(fake.roster.calls).toEqual([])

  await $.tool.call({ tool: START_FRONT_DESK } as never)
  await clock.settle()
  expect(fake.toolCalls('status')).toHaveLength(1)
})

test('a toast says once when an architect gets stuck, and again for a new episode', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster({ items: [] })
  fake.install(on)
  await startFrontDesk($, clock)

  fake.roster.health = 'stalled'
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  expect(fake.roster.toasts).toEqual(['mm-arch-shop looks stuck'])
  expect(fake.roster.status.at(-1)).toBe('MM: 1 stuck')

  fake.roster.health = 'ok'
  await clock.advance(POLL_MS)
  fake.roster.health = 'dead'
  await clock.advance(POLL_MS)
  expect(fake.roster.toasts).toEqual(['mm-arch-shop looks stuck', 'mm-arch-shop has stopped unexpectedly'])
})

test('/multi-manager:pane turns the pane on when this session is the front desk', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  on('command.run', () => ({ text: 'the markdown command ran' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Not marked as the front desk yet, but the roster answers team_health for it: it is the front desk.
  const opened = await $.command.run({ command: 'multi-manager:pane', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(opened.text).toBe('Multi-Manager pane opened.')
  await clock.settle()
  expect(fake.toolCalls('status')).toHaveLength(1)
})

test('/multi-manager:pane in an architect session says where the pane lives', async ($, on) => {
  mock.clock(on)
  mock.env(on, { MM_ROLE: 'architect' })
  const fake = fakeRoster()
  fake.install(on)
  on('command.run', () => ({ text: 'the markdown command ran' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const answered = await $.command.run({ command: 'multi-manager:pane', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(answered.text).toContain('belongs to the front desk session')
  expect(fake.roster.calls).toEqual([])
})
