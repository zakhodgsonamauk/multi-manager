// Pure helpers for the front desk pane: turn the roster tools' JSON into what the pane draws,
// the one-line summary, and which toasts are due. No `$` here, so the logic reads plainly.

import type { PaneArchitect, PaneItem, PaneProject, PaneSessionState, PaneView } from '../types'

// The roster tools' answers, as far as the pane reads them (src/roster/status.ts, tools-health.ts,
// monitor/enforce.ts). Everything is optional-safe: a field the roster stops sending draws as unknown.

export type RosterItem = {
  id: number
  kind: string
  state: string
  body: string
  raised_by?: string | number | null
  created_at?: string
}

export type RosterStatus = {
  projects: {
    name: string
    spend_today_usd: number
    daily_budget_usd: number | null
    workstreams: {
      name: string
      branch: string
      architect: { session_id: number; name: string | null; minutes_since_checkin: number | null } | null
    }[]
    active_goals: { id: number; workstream: string; text: string; spent_usd: number; budget_usd: number | null }[]
  }[]
  waiting_for_user: (RosterItem & { raised_by: string | null; raised_by_running?: boolean })[]
}

export type RosterHealth = {
  paused: boolean
  sessions: {
    session_id: number
    name: string | null
    state: 'ok' | 'hung' | 'stalled' | 'dead'
    status: 'busy' | 'idle' | 'unknown'
    minutes_quiet: number | null
    developers?: { total: number; ok: number; hung: string[]; stalled: string[]; dead: string[] }
  }[]
}

export type RosterResources = {
  session_id: number
  name: string | null
  process_count: number
  max_processes: number | null
  over_max: boolean
  binaries: { binary: string; count: number; session_cap: number | null; machine_cap: number | null; machine_count: number; over: boolean }[]
}[]

export type RosterNudge = { to: string | null; message: string }

/** What answer_item hands back: a nudge to deliver, or null with a note when the raiser has stopped. */
export type RosterAnswerReply = { nudge: RosterNudge | null; note?: string }

/** The text of an MCP result, parsed as the roster's JSON. A tool error throws with the roster's words. */
export function rosterJson(result: { content: readonly { type: string; text?: string }[]; isError: boolean }): unknown {
  const text = result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('')
  if (result.isError) throw new Error(text === '' ? 'the roster reported an error' : text)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** The kinds of item, in the words the pane uses. */
const KIND_WORDS: Record<string, [string, string]> = {
  signoff: ['sign-off', 'sign-offs'],
  question: ['question', 'questions'],
  blocked: ['blocker', 'blockers'],
  done: ['done report', 'done reports'],
  info: ['note', 'notes'],
}

export function kindWord(kind: string, count = 1): string {
  const words = KIND_WORDS[kind] ?? ['item', 'items']
  return count === 1 ? words[0] : words[1]
}

function minutesSince(iso: string | undefined, now: number): number | null {
  if (iso === undefined) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : Math.max(0, Math.floor((now - at) / 60_000))
}

function sessionState(health: RosterHealth['sessions'][number] | undefined): PaneSessionState {
  if (health === undefined) return 'no news'
  if (health.state === 'dead') return 'dead'
  if (health.state === 'hung' || health.state === 'stalled') return 'stuck'
  return health.status === 'unknown' ? 'no news' : health.status
}

function developersLine(devs: NonNullable<RosterHealth['sessions'][number]['developers']>): string | null {
  if (devs.total === 0) return null
  const stuck = [...devs.hung, ...devs.stalled]
  const parts = [`${devs.ok} fine`]
  if (stuck.length > 0) parts.push(`${stuck.length} stuck: ${stuck.join(', ')}`)
  if (devs.dead.length > 0) parts.push(`${devs.dead.length} dead: ${devs.dead.join(', ')}`)
  return `${plural(devs.total, 'developer')} (${parts.join('; ')})`
}

function processesLine(resources: RosterResources[number] | undefined): string | null {
  if (resources === undefined) return null
  const limit = resources.max_processes === null ? '' : ` (limit ${resources.max_processes})`
  return `${plural(resources.process_count, 'process', 'processes')}${limit}`
}

/** One round of roster answers, joined into the pane's view. */
export function buildView(
  input: { status: RosterStatus; health: RosterHealth; items: RosterItem[]; resources: RosterResources },
  now: number,
): PaneView {
  const health = new Map(input.health.sessions.map(s => [s.session_id, s]))
  const resources = new Map(input.resources.map(r => [r.session_id, r]))
  const raisedBy = new Map(input.status.waiting_for_user.map(i => [i.id, i.raised_by]))
  // An older roster sends no raised_by_running: count its raisers as running, as before.
  const stopped = new Set(input.status.waiting_for_user.filter(i => i.raised_by !== null && i.raised_by_running === false).map(i => i.id))

  const projects: PaneProject[] = input.status.projects.map(p => ({
    name: p.name,
    spendTodayUsd: p.spend_today_usd,
    dailyBudgetUsd: p.daily_budget_usd,
    workstreams: p.workstreams.map(w => {
      const a = w.architect
      if (a === null) return { name: w.name, branch: w.branch, architect: null }
      const h = health.get(a.session_id)
      const devs = h?.developers
      const architect: PaneArchitect = {
        sessionId: a.session_id,
        name: a.name ?? `session #${a.session_id}`,
        state: sessionState(h),
        minutesQuiet: h?.minutes_quiet ?? a.minutes_since_checkin,
        developers: devs === undefined ? null : developersLine(devs),
        troubledDevelopers: devs === undefined ? [] : [...devs.hung, ...devs.stalled, ...devs.dead],
        processes: processesLine(resources.get(a.session_id)),
      }
      return { name: w.name, branch: w.branch, architect }
    }),
    goals: p.active_goals.map(g => ({ id: g.id, workstream: g.workstream, text: g.text, spentUsd: g.spent_usd, budgetUsd: g.budget_usd })),
  }))

  const waiting: PaneItem[] = input.items
    .filter(i => i.state === 'open')
    .map(i => {
      const named = raisedBy.get(i.id)
      return {
        id: i.id,
        kind: i.kind,
        body: i.body,
        raisedBy: named ?? (typeof i.raised_by === 'string' ? i.raised_by : null),
        isRaiserStopped: stopped.has(i.id),
        minutesAgo: minutesSince(i.created_at, now),
      }
    })

  const overLimits: string[] = []
  for (const r of input.resources) {
    const who = r.name ?? `session #${r.session_id}`
    if (r.over_max) overLimits.push(`${who}: ${r.process_count} processes, limit ${r.max_processes}`)
    for (const b of r.binaries.filter(x => x.over)) {
      const cap = b.session_cap !== null && b.count > b.session_cap ? `${b.count} of ${b.session_cap} allowed` : `${b.machine_count} machine-wide, ${b.machine_cap} allowed`
      overLimits.push(`${who}: ${b.binary} ${cap}`)
    }
  }

  return { projects, waiting, isPaused: input.health.paused, overLimits, fetchedAt: now }
}

/** Every architect in the view, with its place. */
export function architects(view: PaneView): { project: string; workstream: string; architect: PaneArchitect }[] {
  return view.projects.flatMap(p =>
    p.workstreams.flatMap(w => (w.architect === null ? [] : [{ project: p.name, workstream: w.name, architect: w.architect }])),
  )
}

/** The band and status line: one line, or undefined when there is nothing to say. */
export function summaryLine(view: PaneView | null): string | undefined {
  if (view === null) return undefined
  const parts: string[] = []
  const byKind = new Map<string, number>()
  for (const item of view.waiting) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1)
  for (const [kind, count] of byKind) parts.push(`${count} ${kindWord(kind, count)} waiting`)
  const all = architects(view).map(a => a.architect)
  const stuck = all.filter(a => a.state === 'stuck').length + all.reduce((n, a) => n + a.troubledDevelopers.length, 0)
  const dead = all.filter(a => a.state === 'dead').length
  const busy = all.filter(a => a.state === 'busy').length
  if (stuck > 0) parts.push(`${stuck} stuck`)
  if (dead > 0) parts.push(`${dead} dead`)
  if (busy > 0) parts.push(`${plural(busy, 'architect')} busy`)
  if (view.isPaused) parts.push('paused')
  return parts.length === 0 ? undefined : `MM: ${parts.join(' · ')}`
}

/** Trouble keys ("<name>:stuck", "<name>:dead") for every session in trouble now. */
export function troubleKeys(view: PaneView): string[] {
  const keys: string[] = []
  for (const { architect } of architects(view)) {
    if (architect.state === 'stuck' || architect.state === 'dead') keys.push(`${architect.name}:${architect.state}`)
    for (const dev of architect.troubledDevelopers) keys.push(`${dev}:stuck`)
  }
  return keys
}

/** The toasts due for this view, and the announced sets to keep. */
export function dueToasts(
  view: PaneView,
  announced: { items: readonly number[]; trouble: readonly string[] },
): { toasts: string[]; items: number[]; trouble: string[] } {
  const toasts: string[] = []
  const seenItems = new Set(announced.items)
  for (const item of view.waiting) {
    if (seenItems.has(item.id)) continue
    const from = item.raisedBy === null ? '' : ` from ${item.raisedBy}`
    toasts.push(`New ${kindWord(item.kind)}${from}: ${oneLine(item.body, 80)}`)
  }
  const seenTrouble = new Set(announced.trouble)
  const trouble = troubleKeys(view)
  for (const key of trouble) {
    if (seenTrouble.has(key)) continue
    const cut = key.lastIndexOf(':')
    const name = key.slice(0, cut)
    toasts.push(key.slice(cut + 1) === 'dead' ? `${name} has stopped unexpectedly` : `${name} looks stuck`)
  }
  // Items stay announced while they wait; trouble is forgotten once it clears, so a new episode toasts again.
  return { toasts, items: view.waiting.map(i => i.id), trouble }
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** A body quoted verbatim as Markdown: every line kept, each behind "> ". */
export function quote(body: string): string {
  return body
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

export function money(usd: number): string {
  return `$${usd.toFixed(2)}`
}
