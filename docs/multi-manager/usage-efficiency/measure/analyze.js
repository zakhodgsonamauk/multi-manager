// node analyze.js -> reads calls_14d.csv, turns_14d.jsonl, sessions_14d.json; writes report_14d_3d.json + summary CSVs
const fs = require('fs'), path = require('path');
const D = __dirname;
const sessions = JSON.parse(fs.readFileSync(path.join(D, 'sessions_14d.json'), 'utf8'));
const NOW = Date.now();
const lines = fs.readFileSync(path.join(D, 'calls_14d.csv'), 'utf8').split('\n').filter(Boolean);
const hdr = lines.shift().split(',');
const calls = lines.map(l => {
  const p = l.split(',');
  const o = {}; hdr.forEach((h, i) => o[h] = p[i]);
  for (const k of ['in', 'cw', 'cw1h', 'cr', 'out', 'cost', 'ctx', 'n_tools']) o[k] = +o[k];
  o.gap = o.gap_s === '' ? null : +o.gap_s; o.t = Date.parse(o.ts);
  const s = sessions[o.session];
  o.sub = o.file_kind === 'subagent';
  o.role = o.sub ? (s.parentRole || 'non_mm') : s.role;
  o.mfam = /opus/i.test(o.model) ? 'opus' : /sonnet/i.test(o.model) ? 'sonnet' : /haiku/i.test(o.model) ? 'haiku' : /fable/i.test(o.model) ? 'fable' : o.model;
  return o;
});
const turns = fs.readFileSync(path.join(D, 'turns_14d.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .map(t => (t.role = sessions[t.session].role, t.t = Date.parse(t.ts), t));

const r1 = x => Math.round(x * 10) / 10, r0 = Math.round;
const M = x => r1(x / 1e6);
function q(arr, p) { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }
function agg(rows, keyf) {
  const g = {};
  for (const c of rows) {
    const k = keyf(c); const a = g[k] = g[k] || { calls: 0, in: 0, cw: 0, cr: 0, out: 0, cost: 0 };
    a.calls++; a.in += c.in; a.cw += c.cw; a.cr += c.cr; a.out += c.out; a.cost += c.cost;
  }
  const tot = Object.values(g).reduce((s, a) => s + a.cost, 0);
  return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].cost - a[1].cost).map(([k, a]) => [k, {
    calls: a.calls, fresh_in_M: M(a.in), cache_write_M: M(a.cw), cache_read_M: M(a.cr), output_M: M(a.out),
    est_cost_usd: r0(a.cost), share_pct: r1(100 * a.cost / tot),
    cost_split_pct: { fresh: r1(100 * 5 * a.in / 1e6 / a.cost * 0), } // placeholder replaced below
  }]));
}
function split(rows) {
  let a = { in: 0, cw: 0, cr: 0, out: 0, cost: 0 };
  for (const c of rows) { const p = c.cost / (c.in + 1.25 * c.cw + 0.1 * c.cr + 5 * c.out || 1); a.in += c.in * p; a.cw += 1.25 * c.cw * p; a.cr += 0.1 * c.cr * p; a.out += 5 * c.out * p; a.cost += c.cost; }
  return { fresh: r1(100 * a.in / a.cost), cache_write: r1(100 * a.cw / a.cost), cache_read: r1(100 * a.cr / a.cost), output: r1(100 * a.out / a.cost) };
}
function fixAgg(rows, keyf) {
  const out = agg(rows, keyf);
  for (const k of Object.keys(out)) out[k].cost_split_pct = split(rows.filter(c => keyf(c) === k));
  return out;
}

function report(days) {
  const cut = NOW - days * 864e5;
  const C = calls.filter(c => c.t >= cut);
  const T = turns.filter(t => t.t >= cut);
  const R = {};
  R.window_days = days;
  R.totals = fixAgg(C, () => 'all').all;
  R.by_role = fixAgg(C, c => c.role);
  R.by_role_incl_subagent_flag = fixAgg(C, c => c.role + (c.sub ? '+subagent' : ''));
  R.by_model = fixAgg(C, c => c.model);
  R.by_trigger = fixAgg(C, c => c.trigger);
  R.by_role_trigger = fixAgg(C.filter(c => !c.sub), c => c.role + ' | ' + c.trigger);
  R.subagent_share_pct = r1(100 * C.filter(c => c.sub).reduce((s, c) => s + c.cost, 0) / R.totals.est_cost_usd);

  // tick turns
  const ticks = T.filter(t => t.trigger === 'tick');
  const idle = ticks.filter(t => t.statusOnly);
  const tickTools = {};
  for (const t of ticks) for (const x of new Set(t.tools)) tickTools[x] = (tickTools[x] || 0) + 1;
  R.tick_turns = {
    count: ticks.length, est_cost_usd: r0(ticks.reduce((s, t) => s + t.cost, 0)),
    mean_cost_usd: r1(100 * ticks.reduce((s, t) => s + t.cost, 0) / (ticks.length || 1)) / 100,
    median_api_calls: q(ticks.map(t => t.calls), 0.5),
    status_only_count: idle.length, status_only_cost_usd: r0(idle.reduce((s, t) => s + t.cost, 0)),
    status_only_no_tools_count: idle.filter(t => t.tools.length === 0).length,
    by_role: Object.fromEntries(['front_desk', 'project_manager', 'architect', 'developer', 'non_mm'].map(r => {
      const x = ticks.filter(t => t.role === r), y = x.filter(t => t.statusOnly);
      return [r, { count: x.length, cost: r0(x.reduce((s, t) => s + t.cost, 0)), status_only: y.length, status_only_cost: r0(y.reduce((s, t) => s + t.cost, 0)), median_first_ctx_k: r0(q(x.map(t => t.firstCtx), .5) / 1e3), median_first_cache_write_k: r0(q(x.map(t => t.firstCw), .5) / 1e3) }];
    })),
    top_tools_in_ticks: Object.entries(tickTools).sort((a, b) => b[1] - a[1]).slice(0, 25),
  };
  // turn-level by trigger
  const tt = {};
  for (const t of T) { const a = tt[t.trigger] = tt[t.trigger] || { turns: 0, cost: 0, calls: 0 }; a.turns++; a.cost += t.cost; a.calls += t.calls; }
  R.turns_by_trigger = Object.fromEntries(Object.entries(tt).sort((a, b) => b[1].cost - a[1].cost).map(([k, a]) => [k, { turns: a.turns, api_calls: a.calls, est_cost_usd: r0(a.cost), mean_cost_per_turn: r1(a.cost / a.turns * 100) / 100 }]));
  // cross-session senders
  const xs = {};
  for (const t of T.filter(t => t.trigger === 'cross_session')) { const m = /from-name="([^"]+)"/.exec(t.text); const k = t.role + ' <- ' + (m ? m[1].replace(/-\d+$/, '').replace(/mm-[a-z0-9-]+?-(front-desk|pm|architect|dev)/, '$1') : '?'); xs[k] = (xs[k] || 0) + t.cost; }

  // context sizes per role (main thread)
  const main = C.filter(c => !c.sub);
  R.context_per_call_k = Object.fromEntries(['front_desk', 'project_manager', 'architect', 'developer', 'non_mm'].map(r => {
    const x = main.filter(c => c.role === r).map(c => c.ctx);
    return [r, { calls: x.length, p50: r0(q(x, .5) / 1e3), p90: r0(q(x, .9) / 1e3), max: r0(q(x, 1) / 1e3) }];
  }));
  const firsts = Object.values(sessions).filter(s => s.kind === 'main' && s.firstCtx && Date.parse(s.firstTs) >= cut);
  R.startup_context_k = Object.fromEntries(['front_desk', 'project_manager', 'architect', 'developer', 'non_mm'].map(r => {
    const x = firsts.filter(s => s.role === r).map(s => s.firstCtx);
    return [r, { sessions: x.length, p50: r0(q(x, .5) / 1e3), p90: r0(q(x, .9) / 1e3) }];
  }));
  // cache rebuilds by gap
  const gb = [['<1m', 0, 60], ['1-5m', 60, 300], ['5-10m', 300, 600], ['10-60m', 600, 3600], ['>60m', 3600, 1e12]];
  R.cache_vs_gap = Object.fromEntries(gb.map(([n, lo, hi]) => {
    const x = main.filter(c => c.gap !== null && c.gap >= lo && c.gap < hi && c.ctx > 20000);
    const reb = x.filter(c => c.cw > 0.5 * c.ctx);
    return [n, { calls: x.length, rebuilds_cw_gt_50pct: reb.length, rebuild_pct: r1(100 * reb.length / (x.length || 1)), cache_write_M: M(x.reduce((s, c) => s + c.cw, 0)), est_cost_usd: r0(x.reduce((s, c) => s + c.cost, 0)), rebuild_cost_usd: r0(reb.reduce((s, c) => s + c.cost, 0)) }];
  }));
  const allReb = main.filter(c => c.ctx > 20000 && c.cw > 0.5 * c.ctx);
  R.rebuilds_total = { count: allReb.length, est_cost_usd: r0(allReb.reduce((s, c) => s + c.cost, 0)), cache_write_cost_usd: r0(allReb.reduce((s, c) => s + c.cost * (1.25 * c.cw) / (c.in + 1.25 * c.cw + 0.1 * c.cr + 5 * c.out), 0)), by_trigger: fixAgg(allReb, c => c.trigger) };
  R.cache_write_1h_share_pct = r1(100 * C.reduce((s, c) => s + c.cw1h, 0) / C.reduce((s, c) => s + c.cw, 0));

  // sessions
  const ss = {};
  for (const c of C) {
    const k = c.sub ? c.parent : c.session;
    const s = sessions[k] || {};
    const a = ss[k] = ss[k] || { session: k, role: s.role || c.role, folder: s.folder || c.folder, first: c.t, last: c.t, calls: 0, cost: 0, subCost: 0, trig: {}, split: [] };
    a.first = Math.min(a.first, c.t); a.last = Math.max(a.last, c.t); a.calls++; a.cost += c.cost; if (c.sub) a.subCost += c.cost;
    a.trig[c.sub ? 'subagent' : c.trigger] = (a.trig[c.sub ? 'subagent' : c.trigger] || 0) + c.cost; a.split.push(c);
  }
  const tickCount = {}, idleTick = {};
  for (const t of T.filter(t => t.trigger === 'tick')) { tickCount[t.session] = (tickCount[t.session] || 0) + 1; if (t.statusOnly) idleTick[t.session] = (idleTick[t.session] || 0) + 1; }
  const SL = Object.values(ss).map(a => ({
    session: a.session, role: a.role, folder: a.folder, hours: r1((a.last - a.first) / 36e5), api_calls: a.calls, est_cost_usd: r0(a.cost),
    subagent_cost: r0(a.subCost), ticks: tickCount[a.session] || 0, status_only_ticks: idleTick[a.session] || 0,
    cost_by_trigger: Object.fromEntries(Object.entries(a.trig).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => [k, r0(v)])),
    cost_split_pct: split(a.split),
    p50_ctx_k: r0(q(a.split.filter(c => !c.sub).map(c => c.ctx), .5) / 1e3),
  }));
  R.session_lifetime_hours = Object.fromEntries(['front_desk', 'project_manager', 'architect', 'developer', 'non_mm'].map(r => {
    const x = SL.filter(s => s.role === r);
    return [r, { sessions: x.length, p50_h: q(x.map(s => s.hours), .5), p90_h: q(x.map(s => s.hours), .9), max_h: q(x.map(s => s.hours), 1), total_ticks: x.reduce((s, y) => s + y.ticks, 0) }];
  }));
  R.top_sessions = SL.sort((a, b) => b.est_cost_usd - a.est_cost_usd).slice(0, 10);
  R._all_sessions = SL;
  return R;
}
const out = { note: 'Token counts are MEASURED from transcript usage fields (deduped by message id). Dollar figures are ESTIMATES at API list-price ratios (input $/MTok: opus 5, sonnet 3, haiku 1, fable 15; cache read 0.1x, cache write 1.25x, output 5x). Not what a subscription bills; use for relative shares.', d14: report(14), d3: report(3) };
fs.writeFileSync(path.join(D, 'report.json'), JSON.stringify(out, null, 1));
// flat CSV of all session rows
for (const k of ['d14', 'd3']) {
  const rows = out[k]._all_sessions;
  fs.writeFileSync(path.join(D, `sessions_${k}.csv`), 'session,role,folder,hours,api_calls,est_cost_usd,subagent_cost,ticks,status_only_ticks,p50_ctx_k,fresh_pct,cw_pct,cr_pct,out_pct,top_trigger\n' +
    rows.map(s => [s.session, s.role, s.folder, s.hours, s.api_calls, s.est_cost_usd, s.subagent_cost, s.ticks, s.status_only_ticks, s.p50_ctx_k, s.cost_split_pct.fresh, s.cost_split_pct.cache_write, s.cost_split_pct.cache_read, s.cost_split_pct.output, Object.keys(s.cost_by_trigger)[0]].join(',')).join('\n'));
  delete out[k]._all_sessions;
}
fs.writeFileSync(path.join(D, 'report.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
