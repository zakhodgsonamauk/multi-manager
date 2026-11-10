// Pure helpers for the front desk pane: turn the roster tools' JSON into what the pane draws,
// the one-line summary, and which toasts are due. No `$` here, so the logic reads plainly.

import type { PaneAnswered, PaneArchitect, PaneItem, PaneItemCategory, PaneNote, PaneProject, PaneProjectManager, PaneSessionState, PaneView } from '../types'

// The roster tools' answers, as far as the pane reads them (src/roster/status.ts, tools-health.ts,
// monitor/enforce.ts). Everything is optional-safe: a field the roster stops sending draws as unknown.

export type RosterItem = {
  id: number
  kind: string
  state: string
  body: string
  raised_by?: string | number | null
  created_at?: string
  /** Task 020 adds these to the roster; the pane reads them when present and works out its own when not. */
  category?: string
  project?: string
}

export type RosterStatus = {
  projects: {
    name: string
    spend_today_usd: number
    daily_budget_usd: number | null
    /** Absent from a roster older than project managers. */
    project_manager?: { session_id: number; name: string | null; state: string; model: string | null; last_checkin_at: string | null } | null
    workstreams: {
      name: string
      branch: string
      architect: { session_id: number; name: string | null; minutes_since_checkin: number | null; managed_by?: number | null } | null
    }[]
    active_goals: { id: number; workstream: string; text: string; spent_usd: number; budget_usd: number | null }[]
  }[]
  /** The roster from task 020 on; waiting_for_user is then the same as needs_action. */
  needs_action?: (RosterItem & { raised_by: string | null; raised_by_running?: boolean })[]
  for_information?: (RosterItem & { raised_by: string | null; raised_by_running?: boolean })[]
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
    /** A project manager's architects, nested (the front desk's view). */
    architects?: RosterHealth['sessions']
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
export type RosterAnswerReply = { nudge: RosterNudge | null; watcher_nudge?: RosterNudge | null; note?: string }

/**
 * The text of an MCP result, parsed as the roster's JSON. A tool error throws with the roster's words. An answer
 * that is not JSON (Claude Code swaps a too-big answer for a note like "Error: result (N characters) exceeds
 * maximum allowed tokens...") throws a short plain message naming the tool, so the pane can carry on without it.
 * Every roster tool the pane calls answers in JSON, so none is read as plain text.
 */
export function rosterJson(result: { content: readonly { type: string; text?: string }[]; isError: boolean }, tool = 'roster'): unknown {
  const text = result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('')
  if (result.isError) throw new Error(text === '' ? 'the roster reported an error' : text)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`the roster's ${tool} answer could not be read (it may be too big): ${oneLine(text, 120)}`)
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

type Developers = { total: number; ok: number; hung: string[]; stalled: string[]; dead: string[] }

/** The developers object as the roster sent it, with every missing or odd field made safe. */
function developersOf(value: unknown): Developers | undefined {
  if (!isRecord(value)) return undefined
  return { total: num(value.total), ok: num(value.ok), hung: strings(value.hung), stalled: strings(value.stalled), dead: strings(value.dead) }
}

function developersLine(devs: Developers): string | null {
  if (devs.total === 0) return null
  const stuck = [...devs.hung, ...devs.stalled]
  const parts = [`${devs.ok} fine`]
  if (stuck.length > 0) parts.push(`${stuck.length} stuck: ${stuck.join(', ')}`)
  if (devs.dead.length > 0) parts.push(`${devs.dead.length} dead: ${devs.dead.join(', ')}`)
  return `${plural(devs.total, 'developer')} (${parts.join('; ')})`
}

function processesLine(resources: RosterResources[number] | undefined): string | null {
  if (resources === undefined) return null
  const max = numOrNull(resources.max_processes)
  const limit = max === null ? '' : ` (limit ${max})`
  return `${plural(num(resources.process_count), 'process', 'processes')}${limit}`
}

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const numOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What buildView takes: each answer as the roster sent it, or undefined when that call failed. */
export type RosterAnswers = {
  status?: unknown
  health?: unknown
  items?: unknown
  resources?: unknown
  /** Plain lines for calls that failed outright (their answer is undefined). */
  failures?: readonly string[]
}

/** One round of roster answers, joined into the pane's view. An odd answer leaves its part empty and adds a note. */
export function buildView(input: RosterAnswers, now: number): PaneView {
  const missing: string[] = []
  /** An array the roster should have sent: `what` goes in the note when it is not one, unless that call failed already. */
  const list = <T>(value: unknown, what: string, isFailed: boolean): T[] => {
    if (Array.isArray(value)) return value.filter(isRecord) as T[]
    if (!isFailed) missing.push(what)
    return []
  }
  const status = (isRecord(input.status) ? input.status : {}) as Partial<RosterStatus>
  const isStatusFailed = input.status === undefined
  const waitingForUser = list<RosterStatus['waiting_for_user'][number]>(status.waiting_for_user, 'waiting items', isStatusFailed)
  const statusProjects = list<RosterStatus['projects'][number]>(status.projects, 'projects', isStatusFailed)
  const healthAnswer = (isRecord(input.health) ? input.health : {}) as Partial<RosterHealth>
  const healthSessions = list<RosterHealth['sessions'][number]>(healthAnswer.sessions, 'developer health', input.health === undefined)
  const items = list<RosterItem>(input.items, 'open items', input.items === undefined)
  const resourceRows = list<RosterResources[number]>(input.resources, 'process counts', input.resources === undefined)

  // A project manager's architects come nested under it: flatten so every session is found by id.
  const flatHealth = (sessions: RosterHealth['sessions']): RosterHealth['sessions'] =>
    sessions.flatMap(s => [s, ...flatHealth(Array.isArray(s.architects) ? s.architects.filter(isRecord) : [])])
  const health = new Map(flatHealth(healthSessions).map(s => [s.session_id, s]))
  const resources = new Map(resourceRows.map(r => [r.session_id, r]))
  // The 020 roster splits its answer into needs_action and for_information (waiting_for_user is needs_action only);
  // an older one has waiting_for_user alone. Read every list so each item gets its raiser's name either way.
  const named = [
    ...waitingForUser,
    ...list<RosterStatus['waiting_for_user'][number]>(status.needs_action, 'items needing action', true),
    ...list<RosterStatus['waiting_for_user'][number]>(status.for_information, 'information items', true),
  ]
  const raisedBy = new Map(named.map(i => [i.id, i.raised_by]))
  // An older roster sends no raised_by_running: count its raisers as running, as before.
  const stopped = new Set(named.filter(i => i.raised_by !== null && i.raised_by_running === false).map(i => i.id))

  const projects: PaneProject[] = statusProjects.map(p => {
    const workstreams = list<RosterStatus['projects'][number]['workstreams'][number]>(p.workstreams, `workstreams of ${String(p.name)}`, false)
    const goals = list<RosterStatus['projects'][number]['active_goals'][number]>(p.active_goals, `goals of ${String(p.name)}`, false)
    // No project_manager field (an older roster) or null: no project manager line, and no note about it.
    const pm = isRecord(p.project_manager) ? p.project_manager : null
    const projectManager: PaneProjectManager | null =
      pm === null
        ? null
        : {
            sessionId: num(pm.session_id),
            name: typeof pm.name === 'string' ? pm.name : `session #${String(pm.session_id)}`,
            state: sessionState(health.get(num(pm.session_id))),
            model: typeof pm.model === 'string' ? pm.model : null,
          }
    return {
      name: str(p.name),
      spendTodayUsd: num(p.spend_today_usd),
      dailyBudgetUsd: numOrNull(p.daily_budget_usd),
      projectManager,
      workstreams: workstreams.map(w => {
        const a = isRecord(w.architect) ? w.architect : null
        if (a === null) return { name: str(w.name), branch: str(w.branch), architect: null, isManaged: false }
        const h = health.get(a.session_id)
        const devs = developersOf(h?.developers)
        const architect: PaneArchitect = {
          sessionId: num(a.session_id),
          name: typeof a.name === 'string' ? a.name : `session #${String(a.session_id)}`,
          state: sessionState(h),
          minutesQuiet: numOrNull(h?.minutes_quiet) ?? numOrNull(a.minutes_since_checkin),
          developers: devs === undefined ? null : developersLine(devs),
          troubledDevelopers: devs === undefined ? [] : [...devs.hung, ...devs.stalled, ...devs.dead],
          processes: processesLine(resources.get(a.session_id)),
        }
        return { name: str(w.name), branch: str(w.branch), architect, isManaged: projectManager !== null && a.managed_by === projectManager.sessionId }
      }),
      goals: goals.map(g => ({ id: num(g.id), workstream: str(g.workstream), text: str(g.text), spentUsd: num(g.spent_usd), budgetUsd: numOrNull(g.budget_usd) })),
    }
  })

  const waiting: PaneItem[] = items
    .filter(i => i.state === 'open')
    .map(i => {
      const named = raisedBy.get(i.id)
      const raiser = named ?? (typeof i.raised_by === 'string' ? i.raised_by : null)
      return {
        id: i.id,
        kind: i.kind,
        body: str(i.body),
        raisedBy: raiser,
        project: typeof i.project === 'string' && i.project !== '' ? i.project : projectOf(raiser, projects.map(p => p.name)),
        category: categoryOf(i.kind, i.category),
        isRaiserStopped: stopped.has(i.id),
        minutesAgo: minutesSince(i.created_at, now),
      }
    })
  const action = waiting.filter(i => i.category === 'action').sort((a, b) => byAge(b, a) || a.id - b.id)
  const info = waiting.filter(i => i.category === 'info').sort((a, b) => byAge(a, b) || b.id - a.id)

  const overLimits: string[] = []
  for (const r of resourceRows) {
    const who = typeof r.name === 'string' ? r.name : `session #${String(r.session_id)}`
    if (r.over_max === true) overLimits.push(`${who}: ${num(r.process_count)} processes, limit ${String(numOrNull(r.max_processes) ?? 'unknown')}`)
    const binaries = Array.isArray(r.binaries) ? r.binaries.filter(isRecord) : []
    for (const b of binaries.filter(x => x.over === true)) {
      const sessionCap = numOrNull(b.session_cap)
      const cap =
        sessionCap !== null && num(b.count) > sessionCap
          ? `${num(b.count)} of ${sessionCap} allowed`
          : `${num(b.machine_count)} machine-wide, ${String(numOrNull(b.machine_cap) ?? 'unknown')} allowed`
      overLimits.push(`${who}: ${str(b.binary)} ${cap}`)
    }
  }

  const notes = [...(input.failures ?? [])]
  if (missing.length > 0) notes.push(`Some roster details did not load: ${missing.join(', ')}.`)
  return { projects, waiting, action, info, isPaused: isRecord(input.health) && input.health.paused === true, overLimits, notes, fetchedAt: now }
}

/** Sign-offs, questions and blockers need the user; everything else is information. A category the roster sends wins. */
export function categoryOf(kind: string, given?: unknown): PaneItemCategory {
  if (given === 'action' || given === 'info') return given
  return kind === 'signoff' || kind === 'question' || kind === 'blocked' ? 'action' : 'info'
}

/** The project a session name belongs to: names look like "mm-<project>-...", so the longest project name that fits. */
export function projectOf(raiser: string | null, projects: readonly string[]): string | null {
  if (raiser === null) return null
  const found = projects.filter(p => p !== '' && (raiser === `mm-${p}` || raiser.startsWith(`mm-${p}-`)))
  return found.sort((a, b) => b.length - a.length)[0] ?? null
}

/** Compares by age in minutes (smaller is newer); an item with no age counts as the newest. */
function byAge(a: PaneItem, b: PaneItem): number {
  return (a.minutesAgo ?? -1) - (b.minutesAgo ?? -1)
}

export function ageText(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes < 120) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`
}

/** The compact line for an information item: kind, project, raiser, age, then the first line of its body. */
export function infoLine(item: PaneItem, max = 70): string {
  const head = [`#${item.id} ${kindWord(item.kind)}`, item.project, item.raisedBy, ageText(item.minutesAgo)].filter(x => x !== null && x !== '')
  const first = item.body.split('\n').find(line => line.trim() !== '') ?? ''
  return oneLine(`${head.join(' · ')}${first === '' ? '' : ` · ${first}`}`, max)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Answers sent from the panel in the last 24 hours. */
export function pruneAnswered(list: readonly PaneAnswered[], now: number): PaneAnswered[] {
  return list.filter(a => now - a.at < DAY_MS)
}

export function recentLine(a: PaneAnswered, now: number): string {
  const minutes = Math.max(0, Math.floor((now - a.at) / 60_000))
  return `#${a.id} ${kindWord(a.kind)}${a.project === null ? '' : `, ${a.project}`}: ${oneLine(a.answer, 80)} (${ageText(minutes)})`
}

/**
 * The note handed to the front desk model about what the user did from the panel, or undefined when nothing is queued.
 * Answers are quoted exactly as typed.
 */
export function paneNotesText(notes: readonly PaneNote[]): string | undefined {
  if (notes.length === 0) return undefined
  const parts = notes.map(n => {
    const from = n.raisedBy === null ? '' : `, from ${n.raisedBy}`
    return n.answer === undefined
      ? `cleared item #${n.id} (${n.kind}${from})`
      : `answered item #${n.id} (${n.kind}${from}): "${n.answer}" — do not answer it again`
  })
  return `Multi-Manager pane: since your last turn the user, from the side panel, ${parts.join('; ')}.`
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
