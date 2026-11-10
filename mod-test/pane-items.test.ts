// Pure-function tests for the pane's item sections, the info line, the front-desk note and the 24-hour list.

import { expect, test } from 'claude-code/testing'

import type { PaneItem } from '../types'
import { buildView, infoLine, paneNotesText, pruneAnswered, recentLine } from '../hooks/roster-view.ts'

const NOW = Date.parse('2026-10-21T10:00:00.000Z')
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()

const item = (id: number, kind: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  state: 'open',
  body: `body of ${id}`,
  raised_by: 2,
  created_at: ago(minutes),
  ...extra,
})

const status = (ids: { id: number; kind: string; minutes: number }[]) => ({
  waiting_for_user: ids.map(i => ({ ...item(i.id, i.kind, i.minutes), raised_by: 'mm-shop-arch', raised_by_running: true })),
  projects: [{ name: 'shop', spend_today_usd: 0, daily_budget_usd: null, workstreams: [], active_goals: [] }],
})

test('buildView splits items into action and info, action oldest first, info newest first', () => {
  const rows = [
    { id: 1, kind: 'signoff', minutes: 10 },
    { id: 2, kind: 'done', minutes: 50 },
    { id: 3, kind: 'question', minutes: 90 },
    { id: 4, kind: 'info', minutes: 5 },
    { id: 5, kind: 'blocked', minutes: 30 },
    { id: 6, kind: 'done', minutes: 20 },
  ]
  const view = buildView({ status: status(rows), items: rows.map(r => item(r.id, r.kind, r.minutes)) }, NOW)
  expect(view.action.map(i => i.id)).toEqual([3, 5, 1])
  expect(view.info.map(i => i.id)).toEqual([4, 6, 2])
  expect(view.waiting).toHaveLength(6)
  expect(view.action[0]?.project).toBe('shop')
})

test('buildView leaves an empty section empty, and uses the roster category when it sends one', () => {
  const only = buildView({ items: [item(1, 'done', 5), item(2, 'done', 6, { category: 'action' })] }, NOW)
  expect(only.action.map(i => i.id)).toEqual([2])
  expect(only.info.map(i => i.id)).toEqual([1])
  const none = buildView({ items: [] }, NOW)
  expect(none.action).toEqual([])
  expect(none.info).toEqual([])
})

const base: PaneItem = { id: 815, kind: 'done', body: '\n  Done: cart page ready\nsecond line', raisedBy: 'mm-shop-arch', project: 'shop', category: 'info', isRaiserStopped: false, minutesAgo: 12 }

test('the info line shows kind, project, raiser, age and the first body line, cut to fit', () => {
  expect(infoLine({ ...base, body: 'Done: cart' })).toBe('#815 done report · shop · mm-shop-arch · 12 min ago · Done: cart')
  expect(infoLine({ ...base, project: null, raisedBy: null, minutesAgo: null, body: '' })).toBe('#815 done report')
  const cut = infoLine({ ...base, body: 'x'.repeat(300) }, 60)
  expect(cut).toHaveLength(60)
  expect(infoLine({ ...base, body: 'x'.repeat(300) })).toHaveLength(70)
  expect(cut.endsWith('…')).toBe(true)
})

test('the note for the front desk: one answer, one clear, several mixed, nothing', () => {
  expect(paneNotesText([])).toBeUndefined()
  expect(paneNotesText([{ id: 812, kind: 'signoff', raisedBy: 'mm-x', answer: 'go ahead' }])).toBe(
    'Multi-Manager pane: since your last turn the user, from the side panel, answered item #812 (signoff, from mm-x): "go ahead" — do not answer it again.',
  )
  expect(paneNotesText([{ id: 815, kind: 'info', raisedBy: null }])).toBe(
    'Multi-Manager pane: since your last turn the user, from the side panel, cleared item #815 (info).',
  )
  const typed = '  Yes — keep **v2**.\nThanks  '
  const mixed = paneNotesText([
    { id: 812, kind: 'signoff', raisedBy: 'mm-x', answer: typed },
    { id: 815, kind: 'info', raisedBy: 'mm-y' },
  ])
  expect(mixed).toContain(`"${typed}"`)
  expect(mixed).toContain('; cleared item #815 (info, from mm-y).')
})

test('recent answers older than 24 hours are dropped', () => {
  const mk = (id: number, hours: number) => ({ id, kind: 'signoff', project: 'shop', answer: 'go', at: NOW - hours * 3_600_000 })
  expect(pruneAnswered([mk(1, 1), mk(2, 23.9), mk(3, 24), mk(4, 30)], NOW).map(a => a.id)).toEqual([1, 2])
  expect(recentLine(mk(1, 1), NOW)).toBe('#1 sign-off, shop: go (60 min ago)')
})

test('buildView with a 020-shaped status names the raiser and project of information items too', () => {
  const row = (id: number, kind: string) => ({ ...item(id, kind, 5), raised_by: 'mm-shop-arch', raised_by_running: true, category: kind === 'done' ? 'info' : 'action' })
  const view = buildView(
    {
      status: {
        needs_action: [row(1, 'signoff')],
        for_information: [row(2, 'done')],
        waiting_for_user: [row(1, 'signoff')],
        projects: [{ name: 'shop', spend_today_usd: 0, daily_budget_usd: null, workstreams: [], active_goals: [] }],
      },
      items: [item(1, 'signoff', 5, { category: 'action' }), item(2, 'done', 5, { category: 'info' })],
    },
    NOW,
  )
  expect(view.info[0]?.raisedBy).toBe('mm-shop-arch')
  expect(view.info[0]?.project).toBe('shop')
  expect(view.action[0]?.project).toBe('shop')
  expect(view.notes).toEqual([])
})
