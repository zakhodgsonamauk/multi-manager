// Read-only extraction of Claude Code usage from transcript JSONL files.
// Usage: node extract.js [days=14]
// Writes calls.csv, turns.jsonl, sessions.json into this script's folder.
const fs = require('fs'), path = require('path'), readline = require('readline');
const ROOT = path.join(require('os').homedir(), '.claude', 'projects');
const OUT = __dirname;
const DAYS = +(process.argv[2] || 14);
const NOW = Date.now();
const CUT = NOW - DAYS * 864e5;

function price(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 5;
  if (m.includes('sonnet')) return 3;
  if (m.includes('haiku')) return 1;
  if (m.includes('fable')) return 15;
  return 5;
}
function costOf(u, model) {
  return price(model) * ((u.in || 0) + 1.25 * (u.cw || 0) + 0.1 * (u.cr || 0) + 5 * (u.out || 0)) / 1e6;
}
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(x => x && x.type === 'text').map(x => x.text).join('\n');
}
function isToolResultOnly(content) {
  return Array.isArray(content) && content.length > 0 && content.every(x => x && x.type === 'tool_result');
}
function roleFromText(t) {
  if (/Multi-Manager developer/i.test(t)) return 'developer';
  if (/Multi-Manager architect/i.test(t)) return 'architect';
  if (/Multi-Manager project manager/i.test(t)) return 'project_manager';
  if (/multi-manager:front-desk|Multi-Manager front desk|You are the front desk/i.test(t)) return 'front_desk';
  return null;
}
function classify(o, t, isFirst) {
  const to = o.turnOrigin;
  if (/^Stop hook feedback/.test(t)) return 'stop_hook';
  if (/^This session is being continued from a previous conversation/.test(t)) return 'compaction_resume';
  if (to === 'scheduled' || /<command-name>\/?multi-manager:tick/.test(t)) return /multi-manager:tick/.test(t) || to === 'scheduled' ? 'tick' : 'scheduled_other';
  if (to === 'peer' || /<cross-session-message/.test(t)) return 'cross_session';
  if (to === 'task_notification' || /^<task-notification>/.test(t)) return 'task_notification';
  if (to === 'auto_continuation') return 'auto_continue';
  if (o.isMeta) return null; // skill expansion, reminders, images: not a new trigger
  if (/^You are (the|a) Multi-Manager|^You were restarted|^<command-message>multi-manager:front-desk/.test(t)) return 'launch_prompt';
  if (to === 'human' || o.promptSource === 'typed' || !to) return 'typed';
  return 'other:' + to;
}

const STATUS_TOOLS = new Set([
  'team_health', 'list_items', 'status', 'check_in', 'monitor_tick', 'mark_seen', 'list_sessions', 'pause_status',
  'get_limits', 'model_usage', 'front_desk_digest', 'list_workstreams', 'list_projects', 'get_goal', 'resources',
  'TaskList', 'TaskGet', 'TaskOutput', 'CronList', 'ToolSearch', 'Read', 'Glob', 'Grep',
]);
function shortTool(n) { return n.replace(/^mcp__plugin_multi-manager_roster__/, '').replace(/^mcp__/, 'mcp:'); }

const callsOut = fs.createWriteStream(path.join(OUT, `calls_${DAYS}d.csv`));
callsOut.write('ts,session,parent,file_kind,folder,model,in,cw,cw1h,cr,out,cost,trigger,gap_s,ctx,n_tools,tools\n');
const turnsOut = fs.createWriteStream(path.join(OUT, `turns_${DAYS}d.jsonl`));
const sessions = {}; // key -> info

function listFiles() {
  const res = [];
  for (const d of fs.readdirSync(ROOT)) {
    const dp = path.join(ROOT, d);
    let st; try { st = fs.statSync(dp); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(dp)) {
      const fp = path.join(dp, f);
      if (f.endsWith('.jsonl')) {
        if (fs.statSync(fp).mtimeMs >= CUT) res.push({ fp, folder: d, kind: 'main', session: f.slice(0, -6), parent: null });
      } else {
        const sub = path.join(fp, 'subagents');
        if (fs.existsSync(sub)) {
          for (const g of fs.readdirSync(sub)) {
            if (!g.endsWith('.jsonl')) continue;
            const gp = path.join(sub, g);
            if (fs.statSync(gp).mtimeMs < CUT) continue;
            let agentType = null;
            const mp = gp.replace(/\.jsonl$/, '.meta.json');
            try { const m = JSON.parse(fs.readFileSync(mp, 'utf8')); agentType = m.agentType || m.subagent_type || m.type || null; } catch {}
            res.push({ fp: gp, folder: d, kind: 'subagent', session: g.slice(0, -6), parent: f, agentType });
          }
        }
      }
    }
  }
  return res;
}

async function processFile(F) {
  const key = F.kind === 'main' ? F.session : F.parent + '/' + F.session;
  const S = sessions[key] = {
    key, folder: F.folder, kind: F.kind, parent: F.parent, agentType: F.agentType || null,
    role: null, firstTs: null, lastTs: null, calls: 0, cost: 0, tok: { in: 0, cw: 0, cr: 0, out: 0 },
    byTrigger: {}, firstCtx: null, firstModel: null, models: {},
  };
  const msgs = new Map(); // message.id -> record
  const order = [];
  let trigger = F.kind === 'subagent' ? 'subagent' : 'unknown';
  let turn = null; const turns = [];
  let firstUserSeen = false; let userTexts = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(F.fp), crlfDelay: Infinity });
  for await (const l of rl) {
    if (l.startsWith('{"type":"api-') || l.startsWith('{"type":"file-history') ) continue;
    if (!(l.includes('"type":"user"') || l.includes('"type":"assistant"'))) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'user') {
      const c = o.message && o.message.content;
      if (isToolResultOnly(c)) continue;
      const t = textOf(c);
      if (!S.role && userTexts < 5) { userTexts++; const r = roleFromText(t); if (r) S.role = r; }
      if (F.kind === 'subagent') continue;
      const cls = classify(o, t, !firstUserSeen);
      firstUserSeen = true;
      if (cls) {
        trigger = cls;
        turn = { session: key, folder: F.folder, trigger, ts: o.timestamp, from: (o.origin && o.origin.name) || ((/from-name="([^"]+)"/.exec(t) || [])[1]) || null, text: t.slice(0, 300).replace(/\s+/g, ' '), ids: [], tools: [], outText: 0 };
        turns.push(turn);
      }
    } else if (o.type === 'assistant') {
      const m = o.message; if (!m || !m.usage) continue;
      if (m.model === '<synthetic>') continue;
      const id = m.id || o.requestId || o.uuid;
      let r = msgs.get(id);
      const u = m.usage;
      if (!r) {
        r = { id, ts: o.timestamp, model: m.model, in: 0, cw: 0, cw1h: 0, cr: 0, out: 0, tools: [], text: 0, trigger, turn, side: !!o.isSidechain };
        msgs.set(id, r); order.push(r);
        if (turn) turn.ids.push(r);
      }
      r.in = Math.max(r.in, u.input_tokens || 0);
      r.cw = Math.max(r.cw, u.cache_creation_input_tokens || 0);
      r.cw1h = Math.max(r.cw1h, (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0);
      r.cr = Math.max(r.cr, u.cache_read_input_tokens || 0);
      r.out = Math.max(r.out, u.output_tokens || 0);
      for (const b of (m.content || [])) {
        if (b.type === 'tool_use') r.tools.push(shortTool(b.name));
        else if (b.type === 'text') r.text += (b.text || '').length;
      }
    }
  }
  // emit
  let prevTs = null;
  for (const r of order) {
    const ts = Date.parse(r.ts);
    const gap = prevTs ? Math.round((ts - prevTs) / 1000) : '';
    prevTs = ts;
    if (!(ts >= CUT)) continue;
    const ctx = r.in + r.cw + r.cr;
    const cost = costOf(r, r.model);
    if (S.firstCtx === null) { S.firstCtx = ctx; S.firstModel = r.model; }
    S.calls++; S.cost += cost; S.tok.in += r.in; S.tok.cw += r.cw; S.tok.cr += r.cr; S.tok.out += r.out;
    S.models[r.model] = (S.models[r.model] || 0) + cost;
    const bt = S.byTrigger[r.trigger] = S.byTrigger[r.trigger] || { calls: 0, cost: 0 };
    bt.calls++; bt.cost += cost;
    if (!S.firstTs || r.ts < S.firstTs) S.firstTs = r.ts;
    if (!S.lastTs || r.ts > S.lastTs) S.lastTs = r.ts;
    callsOut.write([r.ts, key, F.parent || '', F.kind, F.folder, r.model, r.in, r.cw, r.cw1h, r.cr, r.out, cost.toFixed(5), r.trigger, gap, ctx, r.tools.length, '"' + r.tools.join(' ') + '"'].join(',') + '\n');
  }
  for (const t of turns) {
    const calls = t.ids.filter(r => Date.parse(r.ts) >= CUT);
    if (!calls.length) continue;
    const tools = [].concat(...calls.map(r => r.tools));
    const tok = calls.reduce((a, r) => (a.in += r.in, a.cw += r.cw, a.cr += r.cr, a.out += r.out, a.cost += costOf(r, r.model), a.outChars += r.text, a), { in: 0, cw: 0, cr: 0, out: 0, cost: 0, outChars: 0 });
    const statusOnly = tools.every(x => STATUS_TOOLS.has(x));
    turnsOut.write(JSON.stringify({ session: t.session, folder: t.folder, trigger: t.trigger, ts: t.ts, from: t.from, text: t.text, calls: calls.length, tools, statusOnly, firstCtx: calls[0].in + calls[0].cw + calls[0].cr, firstCw: calls[0].cw, ...tok }) + '\n');
  }
}

(async () => {
  const files = listFiles();
  console.error('files', files.length);
  let i = 0;
  // main first so subagent parents get roles
  files.sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1));
  for (const F of files) {
    try { await processFile(F); } catch (e) { console.error('ERR', F.fp, e.message); }
    if (++i % 100 === 0) console.error(i);
  }
  // role fallback
  for (const s of Object.values(sessions)) {
    if (s.kind === 'subagent') { const p = sessions[s.parent]; s.parentRole = p ? (p.role || roleFallback(p)) : roleFallback(s); }
    if (!s.role) s.role = roleFallback(s);
  }
  function roleFallback(s) {
    if (/-claude-worktrees-mm-/.test(s.folder)) return 'developer';
    return 'non_mm';
  }
  fs.writeFileSync(path.join(OUT, `sessions_${DAYS}d.json`), JSON.stringify(sessions, null, 1));
  callsOut.end(); turnsOut.end();
  console.error('done');
})();
