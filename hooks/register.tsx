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

import type { PaneConfirm, PaneItem, PaneNote, PaneView } from '../types'
import {
  ageText,
  buildView,
  dueToasts,
  infoLine,
  kindWord,
  money,
  oneLine,
  paneNotesText,
  pruneAnswered,
  quote,
  recentLine,
  rosterJson,
  summaryLine,
  type RosterAnswerReply,
  type RosterNudge,
  type RosterResources,
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
const paneNotes = atom({ plugin: 'multi-manager', key: 'paneNotes' } as const, [])
const recentAnswers = atom({ plugin: 'multi-manager', key: 'recentAnswers' } as const, [])
const expandedInfo = atom({ plugin: 'multi-manager', key: 'expandedInfo' } as const, [])
const isRecentOpen = atom({ plugin: 'multi-manager', key: 'isRecentOpen' } as const, false)

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
  return rosterJson(await $.mcp.call(server, tool, args), tool)
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
    // One failing call does not blank the pane: the others still draw, and the failure becomes a note.
    const settled = await Promise.allSettled([
      roster($, 'status'),
      roster($, 'team_health'),
      roster($, 'list_items', { states: ['open'] }),
      needsResources ? roster($, 'resources') : Promise.resolve(undefined),
    ])
    const failed = settled.flatMap(r => (r.status === 'rejected' ? [r.reason as unknown] : []))
    // The three calls made every poll all failed: the roster is unavailable, and the last good view stays.
    // (resources is not made every poll, so it does not count.)
    if (settled.slice(0, 3).every(r => r.status === 'rejected')) throw failed[0]
    const [status, health, items, freshResources] = settled.map(r => (r.status === 'fulfilled' ? r.value : undefined))
    if (freshResources !== undefined) resources = { at: now, value: freshResources as RosterResources }
    const view = buildView(
      { status, health, items, resources: resources?.value ?? (settled[3].status === 'rejected' ? undefined : []), failures: failed.map(e => oneLine(message(e), 160)) },
      now,
    )
    // A failed call may mean the server restarted: reconnect next time.
    if (failed.length > 0) server = undefined
    const previous = await read($, viewAtom)
    const announced = { items: await read($, announcedItems), trouble: await read($, announcedTrouble) }
    const due = dueToasts(view, announced)
    // A part that failed this round says nothing about what is gone: keep what was announced for it, so
    // recovery does not announce everything again.
    if (settled[2].status === 'rejected') due.items = [...announced.items]
    if (settled[0].status === 'rejected' || settled[1].status === 'rejected') due.trouble = [...announced.trouble]
    // The first view of a session only sets what counts as seen: the front desk shows what waits as it starts.
    if (previous !== null) for (const text of due.toasts) $.ui.toast(text, { timeoutMs: 8000 })
    await update($, announcedItems, () => due.items)
    await update($, announcedTrouble, () => due.trouble)
    await update($, viewAtom, () => view)
    // Forget opened information lines whose items have gone.
    await update($, expandedInfo, ids => (ids.every(id => view.info.some(i => i.id === id)) ? ids : ids.filter(id => view.info.some(i => i.id === id))))
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

/** Finds an open item in the last view, to say what was acted on. */
const findItem = async ($: Engine, id: number): Promise<PaneItem | undefined> => (await read($, viewAtom))?.waiting.find(i => i.id === id)

/**
 * The user answered or cleared an item from the panel: queue a note for the front desk's next turn, show one dim line in
 * the chat, and (for an answer) keep it in the 24-hour list. The model hears of it in the prompt.submit hook below.
 */
const recordAction = async ($: Engine, id: number, answerText?: string): Promise<void> => {
  const item = await findItem($, id)
  const note: PaneNote = { id, kind: item?.kind ?? 'item', raisedBy: item?.raisedBy ?? null, ...(answerText === undefined ? {} : { answer: answerText }) }
  await update($, paneNotes, queue => [...queue, note])
  if (answerText !== undefined) {
    const now = await $.clock.now()
    await update($, recentAnswers, list => [...pruneAnswered(list, now), { id, kind: note.kind, project: item?.project ?? null, answer: answerText, at: now }])
  }
  $.ui.log(answerText === undefined ? `Cleared #${id} from the panel.` : `Answered #${id} from the panel.`)
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
    const result = (await roster($, 'answer_item', { item_id: itemId, answer: text })) as RosterAnswerReply
    drafts.delete(itemId)
    await recordAction($, itemId, text)
    // A project manager that watches the item gets its own nudge: deliver it the way the raiser's is.
    const nudges = [result.nudge, result.watcher_nudge ?? null].filter((n): n is RosterNudge => n !== null)
    // The raiser has stopped: the answer is on record, but there is nobody to nudge and nothing to queue.
    if (nudges.length === 0) $.ui.toast(result.note ?? `Answer saved for #${itemId}. Its raiser is stopped, so nobody was told.`)
    else await deliver($, nudges, `answer sent for item #${itemId}`)
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

/** Closes a waiting item without answering it: nothing else is recorded and nobody is nudged. */
const closeItem = ($: Engine, id: number) =>
  act($, async () => {
    await roster($, 'close_item', { item_id: id })
    drafts.delete(id)
    await recordAction($, id)
    $.ui.toast(`Closed #${id}.`)
  })

/** Clears information items (one, or all of them): closed without a word to anyone but the front desk. */
const clearInfo = ($: Engine, ids: readonly number[]) =>
  act($, async () => {
    // Carry on past a failure. An item the server already cleared meanwhile counts as cleared.
    let failed = 0
    let lastReason = ''
    for (const id of ids) {
      try {
        await roster($, 'close_item', { item_id: id })
      } catch (error) {
        if (!/already (closed|cleared)/i.test(message(error))) {
          failed += 1
          lastReason = message(error)
          continue
        }
      }
      await recordAction($, id)
    }
    if (failed > 0) $.ui.toast(`Could not clear ${failed} of ${ids.length}: ${oneLine(lastReason, 100)}`)
    else $.ui.toast(ids.length === 1 ? `Cleared #${ids[0]}.` : `Cleared ${ids.length} items.`)
  })

const closeGoal = ($: Engine, id: number, state: 'done' | 'cancelled') =>
  act($, async () => {
    await roster($, 'update_goal', { goal_id: id, state })
    $.ui.toast(`Goal #${id} marked ${state}.`)
  })

/** Hiding is refused by the roster while an architect runs there; act() shows its words. */
const hideWorkstream = ($: Engine, project: string, workstream: string) =>
  act($, async () => {
    await roster($, 'archive_workstream', { project, workstream, archived: true })
    $.ui.toast(`Hid ${project}/${workstream}. Ask the front desk to show it again.`)
  })

const hideProject = ($: Engine, project: string) =>
  act($, async () => {
    await roster($, 'archive_project', { project, archived: true })
    $.ui.toast(`Hid ${project}. Ask the front desk to show it again.`)
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

  // The front desk model hears what the user did from the panel: on its next turn, whatever started it, the queued
  // notes ride along as one context entry and the queue empties. Kept apart from any other prompt.submit handling.
  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, isFrontDesk)) || (await isOtherRole($))) return next(e)
    // A prompt the person did not type (isMeta) takes no rewrite when it starts a turn, and a slash command's text is
    // pinned: both pass untouched and the notes wait for the next real turn.
    if (e.isMeta === true || e.command !== undefined) return next(e)
    const queued = await read($, paneNotes)
    const text = paneNotesText(queued)
    if (text === undefined) return next(e)
    const result = await next({ ...e, context: [...(e.context ?? []), text] })
    // Empty the queue only once the prompt went in, and only of the notes attached: more may have been queued meanwhile.
    // A dropped prompt, or a throw above, leaves every note queued.
    if (result.drop === undefined) await update($, paneNotes, queue => queue.slice(queued.length))
    return result
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
    const viewNotes = view.notes.map((line, index) => (
      <Text key={`note-${index}`} dimColor wrap="wrap">
        {line}
      </Text>
    ))

    const now = await $.clock.now()
    const expanded = await read($, expandedInfo)
    const recent = pruneAnswered(await read($, recentAnswers), now)
    const isRecentShown = await read($, isRecentOpen)

    const waiting = view.action.map(item => {
      const from = item.raisedBy === null ? '' : ` from ${item.raisedBy}${item.isRaiserStopped ? ' (stopped)' : ''}`
      const project = item.project === null ? '' : ` (${item.project})`
      const age = item.minutesAgo === null ? '' : ` · ${ageText(item.minutesAgo)}`
      const isSending = sending.includes(item.id)
      const isConfirmingClose = confirm?.kind === 'close-item' && confirm.id === item.id
      const close = (
        <Button
          key={`close-${item.id}`}
          label="Close"
          dimColor
          onPress={() => void update($, confirmAtom, (): PaneConfirm => ({ kind: 'close-item', id: item.id }))}
        />
      )
      return (
        <Box key={`item-${item.id}`} flexDirection="column" marginBottom={1}>
          <Text bold>
            #{item.id} {kindWord(item.kind)}
            {project}
            {from}
            {age}
          </Text>
          <Markdown key={`body-${item.id}`} text={quote(item.body)} />
          {isSending ? (
            <Text dimColor>Sending…</Text>
          ) : isConfirmingClose ? (
            <Box flexDirection="row" gap={1}>
              <Text>Close #{item.id} without answering?</Text>
              <Button key={`close-yes-${item.id}`} label="Yes, close" variant="primary" onPress={() => void closeItem($, item.id)} />
              <Button key={`close-no-${item.id}`} label="Cancel" onPress={cancel} />
            </Box>
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
              {close}
            </Box>
          ) : (
            <Box flexDirection="row" gap={1}>
              <Button key={`approve-${item.id}`} label="Approve" variant="primary" onPress={() => void answer($, item.id, 'Approve')} />
              <Button key={`reject-${item.id}`} label="Reject" onPress={() => void answer($, item.id, 'Reject')} />
              {close}
            </Box>
          )}
        </Box>
      )
    })

    const info = view.info.map(item => {
      const isOpen = expanded.includes(item.id)
      return (
        <Box key={`info-${item.id}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key={`info-clear-${item.id}`} label="Clear" dimColor onPress={() => void clearInfo($, [item.id])} />
            <Button
              key={`info-toggle-${item.id}`}
              label={`${isOpen ? '▾' : '▸'} ${infoLine(item)}`}
              plain
              dimColor
              onPress={() => void update($, expandedInfo, ids => (ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id]))}
            />
          </Box>
          {isOpen && <Markdown key={`info-body-${item.id}`} text={quote(item.body)} />}
        </Box>
      )
    })
    const isConfirmingClearAll = confirm?.kind === 'clear-info'
    const infoHeader = isConfirmingClearAll ? (
      <Box flexDirection="row" gap={1}>
        <Text>Clear all {view.info.length}?</Text>
        <Button key="info-clear-all-yes" label="Yes, clear all" variant="primary" onPress={() => void clearInfo($, view.info.map(i => i.id))} />
        <Button key="info-clear-all-no" label="Cancel" onPress={cancel} />
      </Box>
    ) : (
      <Box flexDirection="row" gap={1}>
        <Text bold>For information ({view.info.length})</Text>
        <Button key="info-clear-all" label="Clear all" dimColor onPress={() => void update($, confirmAtom, (): PaneConfirm => ({ kind: 'clear-info' }))} />
      </Box>
    )

    const projects = view.projects.map(project => {
      const budget = project.dailyBudgetUsd === null ? '' : ` of ${money(project.dailyBudgetUsd)}`
      // Hiding is offered only where nothing runs; the roster refuses it anyway while an architect does.
      const isIdle = project.projectManager === null && project.workstreams.every(ws => ws.architect === null)
      const isConfirmingHide = confirm?.kind === 'hide-project' && confirm.project === project.name
      return (
        <Box key={`project-${project.name}`} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold>
              {project.name} <Text dimColor>· spent today {money(project.spendTodayUsd)}{budget}</Text>
            </Text>
            {isIdle && !isConfirmingHide && (
              <Button
                key={`hide-project-${project.name}`}
                label="Hide project"
                dimColor
                onPress={() => void update($, confirmAtom, (): PaneConfirm => ({ kind: 'hide-project', project: project.name }))}
              />
            )}
          </Box>
          {isConfirmingHide && (
            <Box flexDirection="row" gap={1}>
              <Text>  Hide project {project.name}? Nothing is deleted.</Text>
              <Button key={`hide-project-yes-${project.name}`} label="Yes, hide it" variant="primary" onPress={() => void hideProject($, project.name)} />
              <Button key={`hide-project-no-${project.name}`} label="Cancel" onPress={cancel} />
            </Box>
          )}
          {project.projectManager !== null && (
            <Text color={project.projectManager.state === 'stuck' || project.projectManager.state === 'dead' ? 'red' : undefined}>
              {'  '}
              {project.projectManager.name} (project manager) — {project.projectManager.state}
              {project.projectManager.model === null ? '' : `, model ${project.projectManager.model}`}
            </Text>
          )}
          {/* The project manager's architects come right under it, one step further in. */}
          {[...project.workstreams.filter(ws => ws.isManaged), ...project.workstreams.filter(ws => !ws.isManaged)].map(ws => {
            const a = ws.architect
            const indent = ws.isManaged ? '    ' : '  '
            const place = `${ws.name} (branch ${ws.branch})`
            if (a === null) {
              const isConfirmingHideWs = confirm?.kind === 'hide-workstream' && confirm.project === project.name && confirm.workstream === ws.name
              return (
                <Box key={`ws-${project.name}-${ws.name}`} flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    <Text dimColor>  {place}: no architect running</Text>
                    {!isConfirmingHideWs && (
                      <Button
                        key={`hide-ws-${project.name}-${ws.name}`}
                        label="Hide"
                        dimColor
                        onPress={() =>
                          void update($, confirmAtom, (): PaneConfirm => ({ kind: 'hide-workstream', project: project.name, workstream: ws.name }))
                        }
                      />
                    )}
                  </Box>
                  {isConfirmingHideWs && (
                    <Box flexDirection="row" gap={1}>
                      <Text>    Hide {ws.name} in {project.name}? Nothing is deleted.</Text>
                      <Button
                        key={`hide-ws-yes-${project.name}-${ws.name}`}
                        label="Yes, hide it"
                        variant="primary"
                        onPress={() => void hideWorkstream($, project.name, ws.name)}
                      />
                      <Button key={`hide-ws-no-${project.name}-${ws.name}`} label="Cancel" onPress={cancel} />
                    </Box>
                  )}
                </Box>
              )
            }
            const quiet = a.minutesQuiet === null ? '' : `, quiet ${a.minutesQuiet} min`
            const processes = a.processes === null ? '' : `, ${a.processes}`
            const isConfirming = confirm?.kind === 'stop' && confirm.project === project.name && confirm.workstream === ws.name
            return (
              <Box key={`ws-${project.name}-${ws.name}`} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={a.state === 'stuck' || a.state === 'dead' ? 'red' : undefined}>
                    {indent}
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
                {a.developers !== null && <Text dimColor>{indent}  {a.developers}</Text>}
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
          {project.goals.map(goal => {
            const isConfirmingGoal = confirm?.kind === 'close-goal' && confirm.id === goal.id
            return (
              <Box key={`goal-${goal.id}`} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text dimColor wrap="wrap">
                    {'  '}Goal #{goal.id} ({goal.workstream}): {oneLine(goal.text, 100)} · {money(goal.spentUsd)}
                    {goal.budgetUsd === null ? '' : ` of ${money(goal.budgetUsd)}`}
                  </Text>
                  {!isConfirmingGoal && (
                    <Button
                      key={`goal-close-${goal.id}`}
                      label="Close"
                      dimColor
                      onPress={() => void update($, confirmAtom, (): PaneConfirm => ({ kind: 'close-goal', id: goal.id }))}
                    />
                  )}
                </Box>
                {isConfirmingGoal && (
                  <Box flexDirection="row" gap={1}>
                    <Text>    Close goal #{goal.id}?</Text>
                    <Button key={`goal-done-${goal.id}`} label="Done" variant="primary" onPress={() => void closeGoal($, goal.id, 'done')} />
                    <Button key={`goal-cancelled-${goal.id}`} label="Cancelled" onPress={() => void closeGoal($, goal.id, 'cancelled')} />
                    <Button key={`goal-keep-${goal.id}`} label="Keep" onPress={cancel} />
                  </Box>
                )}
              </Box>
            )
          })}
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
        {viewNotes}
        {view.action.length > 0 && <Text bold>Needs your action ({view.action.length})</Text>}
        {waiting}
        {view.info.length > 0 && infoHeader}
        {info}
        {view.waiting.length === 0 && <Text dimColor>Nothing waiting.</Text>}
        {recent.length > 0 && (
          <Button
            key="recent-toggle"
            label={`${isRecentShown ? '▾' : '▸'} Recently answered (${recent.length})`}
            plain
            dimColor
            onPress={() => void update($, isRecentOpen, open => !open)}
          />
        )}
        {isRecentShown &&
          recent.map(a => (
            <Text key={`recent-${a.id}-${a.at}`} dimColor wrap="wrap">
              {'  '}
              {recentLine(a, now)}
            </Text>
          ))}
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
