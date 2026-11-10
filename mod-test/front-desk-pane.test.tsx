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

type Item = { id: number; kind: string; body: string; raised_by: string | null; raised_by_running?: boolean; created_at: string; project?: string }

const SIGN_OFF: Item = {
  id: 12,
  kind: 'signoff',
  body: 'Plan for checkout:\n1. Cart page\n2. **Payment** step',
  raised_by: 'mm-arch-shop',
  project: 'shop',
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
    /** What answer_item hands back: a nudge, or null with a note when the raiser is stopped. */
    answerReply: null as null | { nudge: null | { to: string; message: string }; watcher_nudge?: { to: string; message: string }; note?: string },
    /** The context entries the engine's prompt.submit received, one list per prompt. */
    contexts: [] as (readonly string[] | undefined)[],
    /** What the engine's prompt.submit does: let the prompt in, drop it, or throw. */
    promptMode: 'ok' as 'ok' | 'drop' | 'throw',
    /** close_item refusals by item id. */
    closeFail: {} as Record<number, string>,
    /** Transcript lines written with $.ui.log. */
    logs: [] as string[],
    /** Tools that answer with this error instead (a refusal). */
    refuse: {} as Record<string, string>,
    /** Replaces the whole status or team_health answer (a project manager's tree, or an older roster's shape). */
    statusOverride: undefined as unknown,
    healthOverride: undefined as unknown,
    /** What front_desk_digest answers; undefined: the tool does not exist (an older roster). */
    digest: undefined as unknown,
    /** Tools that never answer (a hung roster). */
    hang: new Set<string>(),
  }
  const answer = (tool: string, args: Record<string, unknown>): unknown => {
    switch (tool) {
      case 'status':
        if (roster.statusOverride !== undefined) return roster.statusOverride
        return {
          generated_at: '2026-10-21T10:05:00.000Z',
          stale_after_minutes: 30,
          waiting_for_user: roster.items.map(i => ({ raised_by_running: true, ...i })),
          projects: roster.projects
            ? [
                {
                  name: 'shop',
                  folder: 'C:/code/shop',
                  spend_today_usd: 3.2,
                  daily_budget_usd: 20,
                  workstreams: [
                    { name: 'main', branch: 'main', architect: { session_id: 2, name: 'mm-arch-shop', minutes_since_checkin: 1, stale: false } },
                    { name: 'ui', branch: 'feature/ui', architect: null },
                  ],
                  active_goals: [{ id: 3, workstream: 'main', text: 'Build checkout', state: 'active', spent_usd: 1.25, budget_usd: 5 }],
                  open_items: [],
                },
                {
                  name: 'blog',
                  folder: 'C:/code/blog',
                  spend_today_usd: 0,
                  daily_budget_usd: null,
                  workstreams: [{ name: 'main', branch: 'main', architect: null }],
                  active_goals: [],
                  open_items: [],
                },
              ]
            : [],
        }
      case 'team_health':
        if (roster.healthOverride !== undefined) return roster.healthOverride
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
      case 'front_desk_digest':
        if (roster.digest === undefined) throw new Error('Unknown tool: front_desk_digest')
        return roster.digest
      case 'resources':
        return roster.projects
          ? [{ session_id: 2, name: 'mm-arch-shop', role: 'architect', process_count: 12, max_processes: 40, over_max: false, binaries: [] }]
          : []
      case 'answer_item':
        return {
          item: { id: args.item_id, state: 'answered', answer: args.answer },
          ...(roster.answerReply ?? { nudge: { to: 'mm-arch-shop', message: `check roster item #${String(args.item_id)}` } }),
        }
      case 'close_item':
        return { id: args.item_id, state: 'closed' }
      case 'update_goal':
        return { id: args.goal_id, state: args.state }
      case 'archive_workstream':
      case 'archive_project':
        return { archived_at: args.archived === true ? '2026-10-21T10:06:00.000Z' : null }
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
      if (roster.hang.has(e.tool)) return new Promise<never>(() => undefined)
      const failure = e.tool === 'close_item' ? roster.closeFail[Number(e.args.item_id)] : undefined
      if (failure !== undefined) return { value: { content: [{ type: 'text', text: failure }], isError: true } }
      const refusal = roster.refuse[e.tool]
      if (refusal !== undefined) return { value: { content: [{ type: 'text', text: refusal }], isError: true } }
      return { value: { content: [{ type: 'text', text: JSON.stringify(answer(e.tool, e.args)) }], isError: false } }
    })
    on('session.send', (_, e) => {
      roster.sent.push({ to: e.to, text: e.text })
      return roster.deliver ? { isDelivered: true } : { isDelivered: false, reason: 'nobody by that name' }
    })
    on('prompt.submit', (_, e) => {
      roster.prompts.push(e.text)
      roster.contexts.push(e.context)
      if (roster.promptMode === 'throw') throw new Error('boom')
      if (roster.promptMode === 'drop') return { drop: 'no' }
      return { text: e.text, ...(e.context === undefined ? {} : { context: e.context }) }
    })
    on('ui.log', (_, e) => {
      roster.logs.push(e.text)
      return { value: undefined }
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
    expect((await ui.find({ type: 'Text', text: /^#12/ }))?.text).toBe('#12 sign-off (shop) from mm-arch-shop · 5 min ago')
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

  fake.roster.items = [...fake.roster.items, { id: 13, kind: 'question', body: 'Which payment provider?', raised_by: 'mm-arch-shop', project: 'shop', created_at: '2026-10-21T10:04:00.000Z' }]
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

test('Close on a waiting item asks first, then closes it without answering or telling anyone', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'close-12' })
  expect((await ui.find({ type: 'Text', text: /^Close #12/ }))?.text).toBe('Close #12 without answering?')
  await ui.press({ key: 'close-no-12' })
  expect(await ui.find({ type: 'Button', key: 'close-yes-12' })).toBeUndefined()
  expect(fake.toolCalls('close_item')).toHaveLength(0)

  await ui.press({ key: 'close-12' })
  await ui.press({ key: 'close-yes-12' })
  await ui.unmount()
  expect(fake.toolCalls('close_item').map(c => c.args)).toEqual([{ item_id: 12 }])
  expect(fake.toolCalls('answer_item')).toHaveLength(0)
  expect(fake.roster.sent).toEqual([])
  expect(fake.roster.prompts).toEqual([])
  expect(fake.roster.toasts).toContain('Closed #12.')
})

test('an item whose raiser has stopped is labelled, and answering it tells nobody', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster({
    items: [{ id: 14, kind: 'question', body: 'Done: cart page', raised_by: 'mm-arch-old', raised_by_running: false, created_at: '2026-10-21T10:00:00.000Z' }],
  })
  fake.install(on)
  fake.roster.answerReply = { nudge: null, note: 'Answer saved. mm-arch-old is stopped, so nobody was told.' }
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^#14/ }))?.text).toContain('#14 question from mm-arch-old (stopped)')
  await ui.input({ key: 'answer-14', text: 'Thanks, merge it.' })
  await ui.unmount()
  expect(fake.toolCalls('answer_item').map(c => c.args)).toEqual([{ item_id: 14, answer: 'Thanks, merge it.' }])
  expect(fake.roster.sent).toEqual([])
  expect(fake.roster.prompts).toEqual([])
  expect(fake.roster.toasts).toContain('Answer saved. mm-arch-old is stopped, so nobody was told.')
})

test('a running raiser is not labelled stopped', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^#12/ }))?.text).not.toContain('(stopped)')
  await ui.unmount()
})

test('Close on a goal offers Done, Cancelled and Keep', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'goal-close-3' })
  expect(await ui.find({ type: 'Text', text: /Close goal #3\?/ })).toBeDefined()
  await ui.press({ key: 'goal-keep-3' })
  expect(fake.toolCalls('update_goal')).toHaveLength(0)
  await ui.press({ key: 'goal-close-3' })
  await ui.press({ key: 'goal-done-3' })
  await ui.press({ key: 'goal-close-3' })
  await ui.press({ key: 'goal-cancelled-3' })
  await ui.unmount()
  expect(fake.toolCalls('update_goal').map(c => c.args)).toEqual([
    { goal_id: 3, state: 'done' },
    { goal_id: 3, state: 'cancelled' },
  ])
  expect(fake.roster.sent).toEqual([])
})

test('Hide shows only where no architect runs, asks first, and calls the hiding tools', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // shop/main has a running architect: it gets Stop, not Hide, and shop gets no Hide project.
  expect(await ui.find({ type: 'Button', key: 'hide-ws-shop-main' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'hide-project-shop' })).toBeUndefined()

  await ui.press({ key: 'hide-ws-shop-ui' })
  expect(fake.toolCalls('archive_workstream')).toHaveLength(0)
  await ui.press({ key: 'hide-ws-yes-shop-ui' })
  expect(fake.toolCalls('archive_workstream').map(c => c.args)).toEqual([{ project: 'shop', workstream: 'ui', archived: true }])

  await ui.press({ key: 'hide-project-blog' })
  await ui.press({ key: 'hide-project-no-blog' })
  expect(fake.toolCalls('archive_project')).toHaveLength(0)
  await ui.press({ key: 'hide-project-blog' })
  await ui.press({ key: 'hide-project-yes-blog' })
  await ui.unmount()
  expect(fake.toolCalls('archive_project').map(c => c.args)).toEqual([{ project: 'blog', archived: true }])
  expect(fake.roster.sent).toEqual([])
})

test('a refused hide says why', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.refuse.archive_project = 'mm-arch-blog is still running for blog/main: stop it first, then hide it.'
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'hide-project-blog' })
  await ui.press({ key: 'hide-project-yes-blog' })
  await ui.unmount()
  expect(fake.roster.toasts).toContain('That did not work: mm-arch-blog is still running for blog/main: stop it first, then hide it.')
})

const treeHealth = (state: string, status: string, developers?: unknown) => ({
  role: 'architect',
  state,
  status,
  minutes_quiet: 1,
  nudges: 0,
  recommended_action: 'none',
  reason: '',
  ...(developers === undefined ? {} : { developers }),
})
const arch = (id: number, name: string, managedBy: number | null) => ({ session_id: id, name, minutes_since_checkin: 1, stale: false, managed_by: managedBy })

/** A project manager (#10) with two architects (#11, #12) under it, one architect (#13) under the front desk. */
function treeAnswers() {
  const status = {
    generated_at: '2026-10-21T10:05:00.000Z',
    stale_after_minutes: 30,
    waiting_for_user: [],
    projects: [
      {
        name: 'shop',
        folder: 'C:/code/shop',
        spend_today_usd: 1,
        daily_budget_usd: null,
        project_manager: { session_id: 10, name: 'mm-shop-pm', state: 'running', model: 'opus', last_checkin_at: '2026-10-21T10:04:00.000Z' },
        workstreams: [
          { name: 'main', branch: 'main', architect: arch(13, 'mm-shop-main', null) },
          { name: 'ui', branch: 'ui', architect: arch(11, 'mm-shop-ui', 10) },
          { name: 'api', branch: 'api', architect: arch(12, 'mm-shop-api', 10) },
        ],
        active_goals: [],
        open_items: [],
      },
    ],
  }
  const health = {
    paused: false,
    sessions: [
      { session_id: 13, name: 'mm-shop-main', ...treeHealth('ok', 'busy', { total: 1, ok: 1, hung: [], stalled: [], dead: [] }) },
      {
        session_id: 10,
        name: 'mm-shop-pm',
        ...treeHealth('ok', 'busy'),
        role: 'project-manager',
        architects: [
          { session_id: 11, name: 'mm-shop-ui', ...treeHealth('ok', 'busy', { total: 2, ok: 1, hung: ['mm-shop-ui-dev'], stalled: [], dead: [] }) },
          { session_id: 12, name: 'mm-shop-api', ...treeHealth('ok', 'idle', { total: 0, ok: 0, hung: [], stalled: [], dead: [] }) },
        ],
      },
    ],
  }
  return { status, health }
}

test('the pane shows the project manager and puts its architects one level deeper', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster({ items: [] })
  fake.install(on)
  const tree = treeAnswers()
  fake.roster.statusOverride = tree.status
  fake.roster.healthOverride = tree.health
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const pm = await ui.find({ type: 'Text', text: /project manager/ })
  expect(pm?.text).toContain('mm-shop-pm (project manager) — busy, model opus')
  const managed = await ui.find({ type: 'Text', text: /mm-shop-ui/ })
  const own = await ui.find({ type: 'Text', text: /mm-shop-main/ })
  // Managed architects sit two spaces deeper than the one under the front desk.
  expect(managed?.text).toMatch(/^ {4}ui \(branch ui\): mm-shop-ui — busy/)
  expect(own?.text).toMatch(/^ {2}main \(branch main\): mm-shop-main — busy/)
  expect(await ui.find({ type: 'Text', text: /^ {6}2 developers \(1 fine; 1 stuck: mm-shop-ui-dev\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'stop-11' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'stop-13' })).toBeDefined()
  await ui.unmount()
})

test('a status from before project managers draws as before, with no note about the missing field', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /project manager/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /did not load/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^ *main \(branch/ }))?.text).toMatch(/^ {2}main \(branch main\): mm-arch-shop/)
  await ui.unmount()
})

const INFO_ITEMS: Item[] = [
  { id: 20, kind: 'done', body: 'Done: cart page\nsecond line', raised_by: 'mm-arch-shop', project: 'shop', created_at: '2026-10-21T09:50:00.000Z' },
  { id: 21, kind: 'info', body: 'FYI the build is slow today', raised_by: 'mm-arch-shop', project: 'shop', created_at: '2026-10-21T10:01:00.000Z' },
  { id: 22, kind: 'done', body: 'Done: blog theme', raised_by: 'mm-arch-blog', project: 'blog', created_at: '2026-10-21T10:03:00.000Z' },
]
const QUESTION: Item = { id: 13, kind: 'question', body: 'Which payment provider?', raised_by: 'mm-arch-shop', project: 'shop', created_at: '2026-10-21T10:04:00.000Z' }

test('the pane shows an action section first and a compact information section, and renders both', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:05:00.000Z') })
  mock.env(on, {})
  const fake = fakeRoster({ items: [SIGN_OFF, QUESTION, ...INFO_ITEMS] })
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Needs your action/ }))?.text).toBe('Needs your action (2)')
  expect((await ui.find({ type: 'Text', text: /^For information/ }))?.text).toBe('For information (3)')
  expect(await ui.find({ type: 'Text', text: /^Waiting for you/ })).toBeUndefined()
  // Oldest action first: #12 (10:00) then #13 (10:04). Information newest first: 22, 21, 20.
  expect((await ui.find({ type: 'Button', key: 'info-toggle-22' }))?.props.label).toBe('▸ #22 done report · blog · mm-arch-blog · 2 min ago · Done: blog theme')
  expect(await ui.find({ type: 'Input', key: 'answer-20' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', key: 'info-body-20' })).toBeUndefined()
  await ui.press({ key: 'info-toggle-20' })
  expect((await ui.find({ type: 'Markdown', key: 'info-body-20' }))?.text).toBe('> Done: cart page\n> second line')
  await ui.unmount()
})

test('an empty section is not drawn; with nothing waiting one dim line says so', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster({ items: [] })
  fake.install(on)
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Needs your action/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^For information/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Nothing waiting/ }))?.text).toBe('Nothing waiting.')
  await ui.unmount()
})

test('Clear closes one information item at once; Clear all asks once, then closes them all', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:05:00.000Z') })
  mock.env(on, {})
  const fake = fakeRoster({ items: [SIGN_OFF, ...INFO_ITEMS] })
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'info-clear-21' })
  expect(fake.toolCalls('close_item').map(c => c.args)).toEqual([{ item_id: 21 }])
  expect(fake.roster.sent).toEqual([])

  await ui.press({ key: 'info-clear-all' })
  expect(fake.toolCalls('close_item')).toHaveLength(1)
  await ui.press({ key: 'info-clear-all-no' })
  expect(fake.toolCalls('close_item')).toHaveLength(1)
  await ui.press({ key: 'info-clear-all' })
  await ui.press({ key: 'info-clear-all-yes' })
  await ui.unmount()
  expect(fake.toolCalls('close_item').map(c => c.args)).toEqual([{ item_id: 21 }, { item_id: 22 }, { item_id: 21 }, { item_id: 20 }])
})

test('answer delivers both the raiser nudge and the project manager watcher nudge', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.answerReply = { nudge: { to: 'mm-arch-shop', message: 'check roster item #12' }, watcher_nudge: { to: 'mm-shop-pm', message: 'item #12 was answered' } }
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'answer-12', text: 'go ahead' })
  await ui.unmount()
  expect(fake.roster.sent).toEqual([
    { to: 'mm-arch-shop', text: 'check roster item #12' },
    { to: 'mm-shop-pm', text: 'item #12 was answered' },
  ])
})

test('the front desk hears pane actions once, on its next turn, and the chat shows a dim line', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:05:00.000Z') })
  mock.env(on, {})
  const fake = fakeRoster({ items: [SIGN_OFF, ...INFO_ITEMS] })
  fake.install(on)
  await startFrontDesk($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'answer-12', text: 'go ahead' })
  await ui.press({ key: 'info-clear-21' })
  expect(fake.roster.logs).toEqual(['Answered #12 from the panel.', 'Cleared #21 from the panel.'])

  await $.prompt.submit({ text: 'what is new?', wait: false, origin: { kind: 'composer' } })
  expect(fake.roster.contexts.at(-1)).toEqual([
    'Multi-Manager pane: since your last turn the user, from the side panel, answered item #12 (signoff, from mm-arch-shop): "go ahead" — do not answer it again; cleared item #21 (info, from mm-arch-shop).',
  ])
  await $.prompt.submit({ text: 'and now?', wait: false, origin: { kind: 'composer' } })
  expect(fake.roster.contexts.at(-1)).toBeUndefined()

  // The answer stays in the collapsed "Recently answered" list.
  expect((await ui.find({ type: 'Button', key: 'recent-toggle' }))?.props.label).toBe('▸ Recently answered (1)')
  expect(await ui.find({ type: 'Text', text: /^ *#12 sign-off, shop/ })).toBeUndefined()
  await ui.press({ key: 'recent-toggle' })
  expect((await ui.find({ type: 'Text', text: /^ *#12 sign-off, shop/ }))?.text).toBe('  #12 sign-off, shop: go ahead (0 min ago)')
  await ui.unmount()
})

const submit = ($: Engine, text: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)

test('a session that is not the front desk adds no pane note to its prompts, even with one queued', async ($, on) => {
  const clock = mock.clock(on)
  const env: Record<string, string> = {}
  on('env.get', (_, e) => ({ value: env[e.name] }))
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'answer-12', text: 'go' })
  await ui.unmount()
  // The note is queued; now the environment says this is an architect: the note is not added and stays queued.
  env.MM_ROLE = 'architect'
  await submit($, 'not the desk')
  expect(fake.roster.contexts.at(-1)).toBeUndefined()
  delete env.MM_ROLE
  await submit($, 'the desk again')
  expect(fake.roster.contexts.at(-1)?.[0]).toContain('answered item #12')
})

test('the note stays queued when the prompt is dropped, when next throws, and for meta and slash-command prompts', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'answer-12', text: 'go' })
  await ui.unmount()

  // Meta and slash-command prompts pass untouched; the note waits.
  await submit($, 'tick', { isMeta: true })
  expect(fake.roster.contexts.at(-1)).toBeUndefined()
  await submit($, '/some:command', { command: { name: 'some:command', args: '' } })
  expect(fake.roster.contexts.at(-1)).toBeUndefined()

  fake.roster.promptMode = 'drop'
  await submit($, 'one')
  fake.roster.promptMode = 'throw'
  await submit($, 'two').catch(() => undefined)
  fake.roster.promptMode = 'ok'
  fake.roster.contexts.length = 0
  await submit($, 'three')
  expect(fake.roster.contexts.at(-1)?.[0]).toContain('answered item #12')
  fake.roster.contexts.length = 0
  await submit($, 'four')
  expect(fake.roster.contexts.at(-1)).toBeUndefined()
})

test('Clear all carries on past a failed close, treats already-closed as cleared, and says how many failed', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:05:00.000Z') })
  mock.env(on, {})
  const fake = fakeRoster({ items: [SIGN_OFF, ...INFO_ITEMS] })
  fake.install(on)
  fake.roster.closeFail = { 22: 'Item #22 is not yours to close', 21: 'Item #21 is already closed' }
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'info-clear-all' })
  await ui.press({ key: 'info-clear-all-yes' })
  await ui.unmount()
  expect(fake.toolCalls('close_item').map(c => c.args)).toEqual([{ item_id: 22 }, { item_id: 21 }, { item_id: 20 }])
  expect(fake.roster.toasts).toContain('Could not clear 1 of 3: Item #22 is not yours to close')
  expect(fake.roster.logs).toEqual(['Cleared #21 from the panel.', 'Cleared #20 from the panel.'])
})

const TICK = { kind: 'scheduled-trigger' } as const
const tick = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text: '/multi-manager:tick', wait: false, origin: TICK, command: { name: 'multi-manager:tick', args: '' }, ...extra } as never)
const QUIET = { quiet: true, paused: false, act_on: [], idle_past_limit: [], new_items: [], fingerprint: 'q0' }
const TROUBLE = { quiet: false, paused: false, act_on: [{ id: 2, name: 'mm-arch-shop', action: 'nudge' }], idle_past_limit: [], new_items: [], fingerprint: 'f1' }

test('a quiet scheduled check-in is dropped, nothing reaches the chat, and the band says when it ran', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:05:00.000Z') })
  mock.env(on, {})
  const fake = fakeRoster({ items: [] })
  fake.install(on)
  fake.roster.digest = QUIET
  await startFrontDesk($, clock)

  const result = await tick($)
  expect(result.drop).toBeDefined()
  expect(fake.roster.prompts).toEqual([]) // never reached the engine beneath
  expect(fake.roster.logs).toEqual([]) // no transcript line
  expect(fake.toolCalls('front_desk_digest')).toHaveLength(1)
  expect(fake.toolCalls('front_desk_digest')[0]?.args).toEqual({}) // nothing let through yet: no `since`
  expect(fake.roster.status.at(-1)).toMatch(/^MM: 1 architect busy · Last check \d\d:\d\d — all quiet$/)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isCollapsed: false }, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/Last check \d\d:\d\d — all quiet/)
  await ui.unmount()
})

test('a check-in with news goes through with the digest; the same news again is swallowed', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:05:00.000Z') })
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = TROUBLE
  await startFrontDesk($, clock)

  const first = await tick($)
  expect(first.drop).toBeUndefined()
  expect(fake.roster.prompts).toEqual(['/multi-manager:tick'])
  expect(fake.roster.contexts.at(-1)?.[0]).toContain(JSON.stringify(TROUBLE))

  // Ten minutes on, same fingerprint: swallowed; `since` is the time of the one let through.
  await clock.advance(600_000)
  const second = await tick($)
  expect(second.drop).toBeDefined()
  expect(fake.roster.prompts).toHaveLength(1)
  expect(fake.toolCalls('front_desk_digest').at(-1)?.args).toEqual({ since: '2026-10-21T10:05:00.000Z' })
  expect(fake.roster.status.at(-1)).toMatch(/Last check \d\d:\d\d — nothing new$/)

  // New fingerprint: through again, and the "last check" note goes.
  fake.roster.digest = { ...TROUBLE, fingerprint: 'f2' }
  const third = await tick($)
  expect(third.drop).toBeUndefined()
  expect(fake.roster.prompts).toHaveLength(2)
})

test('trouble that clears and comes back is shown again', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = TROUBLE
  await startFrontDesk($, clock)
  await tick($)
  fake.roster.digest = QUIET
  expect((await tick($)).drop).toBeDefined()
  fake.roster.digest = TROUBLE
  expect((await tick($)).drop).toBeUndefined()
  expect(fake.roster.prompts).toHaveLength(2)
})

test('a paused roster drops the check-in', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = { ...TROUBLE, paused: true }
  await startFrontDesk($, clock)
  expect((await tick($)).drop).toBeDefined()
  expect(fake.roster.status.at(-1)).toMatch(/Last check \d\d:\d\d — paused$/)
})

test('the check-in goes through unchanged when the digest cannot be had or is odd', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  await startFrontDesk($, clock)

  // Old roster: no digest tool.
  expect((await tick($)).drop).toBeUndefined()
  // Odd answer.
  fake.roster.digest = { hello: 'there' }
  expect((await tick($)).drop).toBeUndefined()
  // Roster refuses.
  fake.roster.refuse.front_desk_digest = 'Only the front desk can call front_desk_digest'
  expect((await tick($)).drop).toBeUndefined()
  expect(fake.roster.prompts).toHaveLength(3)
  expect(fake.roster.contexts.every(c => c === undefined)).toBe(true)
})

test('a tick the user typed, and other scheduled prompts, are never swallowed', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = QUIET
  await startFrontDesk($, clock)

  const typed = { text: '/multi-manager:tick', wait: false, origin: { kind: 'composer' }, command: { name: 'multi-manager:tick', args: '' } }
  expect((await $.prompt.submit(typed as never)).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'water the plants', wait: false, origin: TICK } as never)).drop).toBeUndefined()
  expect(fake.roster.prompts).toHaveLength(2)
  expect(fake.toolCalls('front_desk_digest')).toEqual([])
})

test('a session that is not the front desk lets its scheduled tick through', async ($, on) => {
  const clock = mock.clock(on)
  const env: Record<string, string> = {}
  on('env.get', (_, e) => ({ value: env[e.name] }))
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = QUIET
  await startFrontDesk($, clock)
  env.MM_ROLE = 'architect'
  expect((await tick($)).drop).toBeUndefined()
  expect(fake.toolCalls('front_desk_digest')).toEqual([])
})

test('a digest that never answers lets the tick through within the limit', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = QUIET
  fake.roster.hang.add('front_desk_digest')
  await startFrontDesk($, clock)

  let result: { drop?: string } | undefined
  const pending = tick($).then(r => (result = r))
  await clock.advance(3000)
  expect(result).toBeUndefined() // still waiting
  await clock.advance(1500)
  await pending
  expect(result?.drop).toBeUndefined()
  expect(fake.roster.prompts).toEqual(['/multi-manager:tick'])
  expect(fake.roster.contexts.at(-1)).toBeUndefined()
})

test('a check-in neither attaches nor empties the pane notes', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = TROUBLE
  await startFrontDesk($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'answer-12', text: 'go' })
  await ui.unmount()

  await tick($)
  expect(fake.roster.contexts.at(-1)).toEqual([expect.stringContaining('check-in digest')])
  expect(fake.roster.contexts.at(-1)?.join('')).not.toContain('answered item #12')
  await submit($, 'next real turn')
  expect(fake.roster.contexts.at(-1)?.[0]).toContain('answered item #12')
})

test('a check-in that the engine beneath drops is not remembered as let through', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  const fake = fakeRoster()
  fake.install(on)
  fake.roster.digest = TROUBLE
  await startFrontDesk($, clock)
  fake.roster.promptMode = 'drop'
  expect((await tick($)).drop).toBeDefined()
  fake.roster.promptMode = 'ok'
  // Same fingerprint, but the first never entered: this one must go through.
  expect((await tick($)).drop).toBeUndefined()
  expect(fake.roster.prompts).toHaveLength(2)
  expect(fake.toolCalls('front_desk_digest').at(-1)?.args).toEqual({})
})
