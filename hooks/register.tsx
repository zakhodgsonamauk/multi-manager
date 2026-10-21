// The Multi-Manager front desk pane: a mod (Claude Code's plugin UI layer) drawn only in the front desk session.
// Design: conductor/designs/2026-10-21-multi-manager-design.md, "9. Front desk pane".
//
// - Gate: an architect or developer session (MM_ROLE set to anything but front-desk) gets no timer and draws
//   nothing. Any other session turns the pane on once it is the front desk: the model's start_front_desk call
//   succeeds, MM_ROLE=front-desk, or /multi-manager:pane finds team_health answering (only the front desk's
//   roster server answers it without MM_ROLE). The flag lives in $.state, so a reload keeps it.
// - Data: the roster MCP tools (status, team_health, list_items, resources) every 15 s and right after any
//   button; the last good answer stays in $.state.
// - Writes go through the same roster tools as the chat. Their nudges are delivered with $.session.send (the
//   SendMessage tool's own delivery); any that cannot be are handed to the front desk as a queued prompt.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PaneConfirm, PaneView } from '../types'
import {
  buildView,
  dueToasts,
  kindWord,
  money,
  oneLine,
  quote,
  rosterJson,
  summaryLine,
  type RosterHealth,
  type RosterItem,
  type RosterNudge,
  type RosterResources,
  type RosterStatus,
} from './roster-view.ts'

type Engine = EngineInterface

const PANE = 'multi-manager'
const TITLE = 'Multi-Manager'
const POLL_MS = 15_000
/** The process snapshot behind `resources` is the costly call: refresh it at most this often unless a button asks. */
const RESOURCES_MS = 60_000

const isFrontDesk = atom({ plugin: 'multi-manager', key: 'isFrontDesk' } as const, false)
const viewAtom = atom({ plugin: 'multi-manager', key: 'view' } as const, null)
const unavailable = atom({ plugin: 'multi-manager', key: 'unavailable' } as const, null)
const announcedItems = atom({ plugin: 'multi-manager', key: 'announcedItems' } as const, [])
const announcedTrouble = atom({ plugin: 'multi-manager', key: 'announcedTrouble' } as const, [])
const confirmAtom = atom({ plugin: 'multi-manager', key: 'confirm' } as const, null)
const sendingItems = atom({ plugin: 'multi-manager', key: 'sendingItems' } as const, [])

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// Module state: lost on a reload, which is fine. Drafts are what the person has typed so far per item.
let server: string | undefined
let timer: { cancel: () => void } | undefined
let isPolling = false
/** A button asked for fresh data while a poll ran: poll again when it ends. */
let isPollWanted = false
let resources: { at: number; value: RosterResources } | undefined
let isPaneAutoOpened = false
const drafts = new Map<number, string>()

/** Architects and developers run the plugin too: they never draw or poll. */
const isOtherRole = async ($: Engine): Promise<boolean> => {
  const role = await $.env.get('MM_ROLE')
  return role !== undefined && role !== '' && role !== 'front-desk'
}

const roster = async ($: Engine, tool: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  if (server === undefined) {
    const connected = await $.mcp.connect('roster')
    if (!connected.isConnected) throw new Error(`the roster is not connected (${connected.reason})`)
    server = connected.server
  }
  return rosterJson(await $.mcp.call(server, tool, args))
}

const poll = async ($: Engine, options: { fresh?: boolean } = {}): Promise<void> => {
  if (isPolling) {
    if (options.fresh === true) isPollWanted = true
    return
  }
  if (!(await read($, isFrontDesk))) return
  isPolling = true
  try {
    const now = await $.clock.now()
    const needsResources = options.fresh === true || resources === undefined || now - resources.at >= RESOURCES_MS
    const [status, health, items, freshResources] = await Promise.all([
      roster($, 'status') as Promise<RosterStatus>,
      roster($, 'team_health') as Promise<RosterHealth>,
      roster($, 'list_items', { states: ['open'] }) as Promise<RosterItem[]>,
      needsResources ? (roster($, 'resources') as Promise<RosterResources>) : Promise.resolve(undefined),
    ])
    if (freshResources !== undefined) resources = { at: now, value: freshResources }
    const view = buildView({ status, health, items, resources: resources?.value ?? [] }, now)
    const previous = await read($, viewAtom)
    const due = dueToasts(view, { items: await read($, announcedItems), trouble: await read($, announcedTrouble) })
    // The first view of a session only sets what counts as seen: the front desk shows what waits as it starts.
    if (previous !== null) for (const text of due.toasts) $.ui.toast(text, { timeoutMs: 8000 })
    await update($, announcedItems, () => due.items)
    await update($, announcedTrouble, () => due.trouble)
    await update($, viewAtom, () => view)
    await update($, unavailable, () => null)
    $.ui.status(summaryLine(view))
  } catch (error) {
    server = undefined // reconnect next time, in case the roster server restarted
    await update($, unavailable, () => oneLine(message(error), 160))
  } finally {
    isPolling = false
    if (isPollWanted) {
      isPollWanted = false
      void poll($, { fresh: true })
    }
  }
}

const startTimer = ($: Engine): void => {
  timer ??= $.clock.every(POLL_MS, () => void poll($))
}

const activate = async ($: Engine): Promise<void> => {
  if (!(await read($, isFrontDesk))) await update($, isFrontDesk, () => true)
  startTimer($)
  await poll($, { fresh: true })
}

/** Delivers roster nudges; any that cannot go directly are queued for the front desk to send. */
const deliver = async ($: Engine, nudges: readonly RosterNudge[], what: string): Promise<void> => {
  const failed: RosterNudge[] = []
  for (const nudge of nudges) {
    if (nudge.to === null) {
      failed.push(nudge)
      continue
    }
    try {
      const sent = await $.session.send({ to: nudge.to, text: nudge.message })
      if (!sent.isDelivered) failed.push(nudge)
    } catch {
      failed.push(nudge)
    }
  }
  if (failed.length === 0) {
    $.ui.toast(`Done: ${what}.`)
    return
  }
  const lines = failed.map(n => `- to ${n.to ?? '(no session name on record: tell the user)'}: "${n.message}"`)
  void $.prompt.submit({
    text:
      `The Multi-Manager pane recorded ${what}, but could not deliver these roster nudges itself. ` +
      `Send each one now with SendMessage, exactly as written, and do nothing else:\n${lines.join('\n')}`,
  })
  $.ui.toast(`Done: ${what}. The front desk will pass the word on.`)
}

const answer = async ($: Engine, itemId: number, text: string): Promise<void> => {
  if (text.trim() === '') {
    $.ui.toast('Type an answer first.')
    return
  }
  if ((await read($, sendingItems)).includes(itemId)) return
  await update($, sendingItems, ids => [...ids, itemId])
  try {
    // The user's words exactly as typed: no trimming, no rewording.
    const result = (await roster($, 'answer_item', { item_id: itemId, answer: text })) as { nudge: RosterNudge }
    drafts.delete(itemId)
    await deliver($, [result.nudge], `answer sent for item #${itemId}`)
  } catch (error) {
    $.ui.toast(`Could not send the answer: ${oneLine(message(error), 120)}`)
  } finally {
    await update($, sendingItems, ids => ids.filter(id => id !== itemId))
    await poll($, { fresh: true })
  }
}

const act = async ($: Engine, run: () => Promise<void>): Promise<void> => {
  await update($, confirmAtom, () => null)
  try {
    await run()
  } catch (error) {
    $.ui.toast(`That did not work: ${oneLine(message(error), 120)}`)
  }
  await poll($, { fresh: true })
}

const pauseAll = ($: Engine) =>
  act($, async () => {
    const result = (await roster($, 'pause', {})) as { sessions: { name: string; nudge: string }[] }
    if (result.sessions.length === 0) $.ui.toast('Paused. Nothing was running.')
    else await deliver($, result.sessions.map(s => ({ to: s.name, message: s.nudge })), 'paused everything')
  })

const resume = ($: Engine) =>
  act($, async () => {
    const result = (await roster($, 'resume', {})) as { architects: { name: string; relaunched: boolean; nudge?: string }[] }
    const nudges = result.architects.flatMap(a => (a.nudge === undefined ? [] : [{ to: a.name, message: a.nudge }]))
    const relaunched = result.architects.filter(a => a.relaunched).length
    await deliver($, nudges, `resumed (${relaunched} architect${relaunched === 1 ? '' : 's'} restarted)`)
  })

const stopArchitect = ($: Engine, project: string, workstream: string, name: string) =>
  act($, async () => {
    await roster($, 'stop_architect', { project, workstream })
    $.ui.toast(`Stopped ${name}.`)
  })

const openPane = ($: Engine) => $.ui.open({ id: PANE, title: TITLE })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (await isOtherRole($)) return started
    // The timer is cheap until this session is the front desk: each tick reads one flag and stops.
    startTimer($)
    if ((await read($, isFrontDesk)) || (await $.env.get('MM_ROLE')) === 'front-desk') void activate($)
    return started
  })

  // The front desk briefing starts with start_front_desk: once it succeeds, this session is the front desk.
  on('tool.call', { tool: 'mcp__plugin_multi-manager_roster__start_front_desk' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && !(await isOtherRole($))) void activate($)
    return ran
  }).catch(($, e, next) => next(e))

  // /multi-manager:pane is commands/pane.md; here the mod answers it itself, so no model turn runs.
  on('command.run', { command: 'multi-manager:pane' }, async $ => {
    if (await isOtherRole($)) return { text: 'The Multi-Manager pane belongs to the front desk session, not to an architect or developer.' }
    if (!(await read($, isFrontDesk))) {
      const isDesk = await roster($, 'team_health').then(
        () => true,
        () => false,
      )
      if (!isDesk) return { text: 'The Multi-Manager pane only works in the front desk session. Run /multi-manager:front-desk first.' }
      await activate($)
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Multi-Manager pane opened.' : 'The Multi-Manager pane will show when there is room for it.' }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await read($, isFrontDesk))) return next(e)
    // Open the pane unasked only where the surface docks it beside the transcript.
    if (!isPaneAutoOpened && e.viewport?.isFullscreen === true) {
      isPaneAutoOpened = true
      void openPane($)
    }
    const line = summaryLine(await read($, viewAtom))
    if (e.props.hasSurvey || line === undefined) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box key="mm-band">
        <Text wrap="truncate-end">{line} </Text>
        <Button key="mm-show" label="Show" plain dimColor onPress={() => void openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = elements
    // The mobile app has no text field (its table stands a blank box in for one): it gets quick answers.
  const Input = e.surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined

    if (!(await read($, isFrontDesk))) {
      return <Text dimColor>The Multi-Manager pane works in the front desk session only. Run /multi-manager:front-desk there.</Text>
    }

    const view: PaneView | null = await read($, viewAtom)
    const problem = await read($, unavailable)
    const confirm: PaneConfirm = await read($, confirmAtom)
    const sending = await read($, sendingItems)
    const cancel = () => void update($, confirmAtom, () => null)

    const notice =
      problem === null ? null : (
        <Text dimColor wrap="wrap">
          Roster unavailable{view === null ? '' : ' (showing the last answer)'}: {problem}
        </Text>
      )
    if (view === null) return <Box flexDirection="column">{notice ?? <Text dimColor>Loading from the roster…</Text>}</Box>

    const waiting = view.waiting.map(item => {
      const from = item.raisedBy === null ? '' : ` from ${item.raisedBy}`
      const age = item.minutesAgo === null ? '' : ` · ${item.minutesAgo} min ago`
      const isSending = sending.includes(item.id)
      return (
        <Box key={`item-${item.id}`} flexDirection="column" marginBottom={1}>
          <Text bold>
            #{item.id} {kindWord(item.kind)}
            {from}
            {age}
          </Text>
          <Markdown key={`body-${item.id}`} text={quote(item.body)} />
          {isSending ? (
            <Text dimColor>Sending…</Text>
          ) : Input !== undefined ? (
            <Box flexDirection="row" gap={1}>
              <Input
                key={`answer-${item.id}`}
                placeholder="Type your answer"
                value={drafts.get(item.id) ?? ''}
                submitLabel="send"
                onInput={value => void drafts.set(item.id, value)}
                onSubmit={value => void answer($, item.id, value)}
              />
              <Button key={`send-${item.id}`} label="Send" variant="primary" onPress={() => void answer($, item.id, drafts.get(item.id) ?? '')} />
            </Box>
          ) : (
            <Box flexDirection="row" gap={1}>
              <Button key={`approve-${item.id}`} label="Approve" variant="primary" onPress={() => void answer($, item.id, 'Approve')} />
              <Button key={`reject-${item.id}`} label="Reject" onPress={() => void answer($, item.id, 'Reject')} />
            </Box>
          )}
        </Box>
      )
    })

    const projects = view.projects.map(project => {
      const budget = project.dailyBudgetUsd === null ? '' : ` of ${money(project.dailyBudgetUsd)}`
      return (
        <Box key={`project-${project.name}`} flexDirection="column" marginBottom={1}>
          <Text bold>
            {project.name} <Text dimColor>· spent today {money(project.spendTodayUsd)}{budget}</Text>
          </Text>
          {project.workstreams.map(ws => {
            const a = ws.architect
            const place = `${ws.name} (branch ${ws.branch})`
            if (a === null) return <Text dimColor>  {place}: no architect running</Text>
            const quiet = a.minutesQuiet === null ? '' : `, quiet ${a.minutesQuiet} min`
            const processes = a.processes === null ? '' : `, ${a.processes}`
            const isConfirming = confirm?.kind === 'stop' && confirm.project === project.name && confirm.workstream === ws.name
            return (
              <Box key={`ws-${project.name}-${ws.name}`} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={a.state === 'stuck' || a.state === 'dead' ? 'red' : undefined}>
                    {'  '}
                    {place}: {a.name} — {a.state}
                    {quiet}
                    {processes}
                  </Text>
                  {!isConfirming && (
                    <Button
                      key={`stop-${a.sessionId}`}
                      label="Stop"
                      dimColor
                      onPress={() => void update($, confirmAtom, (): PaneConfirm => ({ kind: 'stop', project: project.name, workstream: ws.name, name: a.name }))}
                    />
                  )}
                </Box>
                {a.developers !== null && <Text dimColor>    {a.developers}</Text>}
                {isConfirming && (
                  <Box flexDirection="row" gap={1}>
                    <Text>    Stop {a.name} and its developers? Its tab closes.</Text>
                    <Button key={`stop-yes-${a.sessionId}`} label="Yes, stop it" variant="primary" onPress={() => void stopArchitect($, project.name, ws.name, a.name)} />
                    <Button key={`stop-no-${a.sessionId}`} label="Cancel" onPress={cancel} />
                  </Box>
                )}
              </Box>
            )
          })}
          {project.goals.map(goal => (
            <Text dimColor wrap="wrap">
              {'  '}Goal #{goal.id} ({goal.workstream}): {oneLine(goal.text, 100)} · {money(goal.spentUsd)}
              {goal.budgetUsd === null ? '' : ` of ${money(goal.budgetUsd)}`}
            </Text>
          ))}
        </Box>
      )
    })

    const isConfirmingPause = confirm?.kind === 'pause'
    const controls = view.isPaused ? (
      <Box flexDirection="row" gap={1}>
        <Text>Everything is paused.</Text>
        <Button key="mm-resume" label="Resume" variant="primary" onPress={() => void resume($)} />
      </Box>
    ) : isConfirmingPause ? (
      <Box flexDirection="row" gap={1}>
        <Text>Pause everything? Nothing new starts until you resume.</Text>
        <Button key="mm-pause-yes" label="Yes, pause all" variant="primary" onPress={() => void pauseAll($)} />
        <Button key="mm-pause-no" label="Cancel" onPress={cancel} />
      </Box>
    ) : (
      <Button key="mm-pause" label="Pause all" onPress={() => void update($, confirmAtom, (): PaneConfirm => ({ kind: 'pause' }))} />
    )

    return (
      <Box flexDirection="column">
        {notice}
        <Text bold>Waiting for you ({view.waiting.length})</Text>
        {waiting.length === 0 ? <Text dimColor>Nothing is waiting for you.</Text> : waiting}
        <Text bold>Projects</Text>
        {projects.length === 0 ? <Text dimColor>No projects yet.</Text> : projects}
        {view.overLimits.length > 0 && <Text bold>Over a limit</Text>}
        {view.overLimits.map(line => (
          <Text color="red">
            {'  '}
            {line}
          </Text>
        ))}
        {controls}
      </Box>
    )
  })
}
