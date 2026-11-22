'use strict';
// Token-level numbers for the Optimize tab, read from Claude transcripts (usage fields). Counts only; no prices, since they change.
const fs = require('fs');
const { findFile, allSessions } = require('./sessions');
const { scanSkills, readCfg, writeCfg } = require('./skills');
const FAMS = ['opus', 'sonnet', 'haiku', 'other'];
const prices = () => readCfg().prices || {};  // $ per million tokens, entered by the user: { opus: { in, out, cr, cc }, ... }
function costOf(m, pr = prices()) { let c = 0; for (const [f, t] of Object.entries(m || {})) { const p = pr[f]; if (p) c += (t.in * (+p.in || 0) + t.out * (+p.out || 0) + t.cr * (+p.cr || 0) + t.cc * (+p.cc || 0)) / 1e6; } return c; }
function setPrices(b) { const c = readCfg(), pr = {}; for (const f of FAMS) { const p = (b.prices || {})[f] || {}; const n = k => { const v = +p[k]; return Number.isFinite(v) && v >= 0 && v <= 1000 ? v : 0; }; pr[f] = { in: n('in'), out: n('out'), cr: n('cr'), cc: n('cc') }; } c.prices = pr; const bd = +b.budget; c.budget = Number.isFinite(bd) && bd > 0 && bd < 1e6 ? bd : 0; writeCfg(c); return { prices: pr, budget: c.budget }; }
const cache = new Map();
function fileTokens(f) {
  let st; try { st = fs.statSync(f); } catch { return null; }
  const h = cache.get(f); if (h && h.m === st.mtimeMs) return h.v;
  const v = { in: 0, out: 0, cr: 0, cc: 0, turns: 0, m: {} }, seen = new Set();
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l.includes('"usage"')) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    const m = o.message; if (!m || !m.usage) continue; const key = (m.id || '') + ':' + (o.requestId || ''); if (m.id && seen.has(key)) continue; seen.add(key);
    const u = m.usage; v.in += u.input_tokens || 0; v.out += u.output_tokens || 0; v.cr += u.cache_read_input_tokens || 0; v.cc += u.cache_creation_input_tokens || 0; v.turns++; const fam = /opus/i.test(m.model || '') ? 'opus' : /sonnet/i.test(m.model || '') ? 'sonnet' : /haiku/i.test(m.model || '') ? 'haiku' : 'other', x = (v.m[fam] ||= { in: 0, out: 0, cr: 0, cc: 0 }); x.in += u.input_tokens || 0; x.out += u.output_tokens || 0; x.cr += u.cache_read_input_tokens || 0; x.cc += u.cache_creation_input_tokens || 0;
  }
  cache.set(f, { m: st.mtimeMs, v }); return v;
}
function tokenReport() {
  const byRepo = {}, top = [];
  for (const s of allSessions().sessions) {
    const f = findFile(s.id); if (!f) continue; const t = fileTokens(f); if (!t || !t.turns) continue;
    const r = (byRepo[s.repo || s.cwd] ||= { repo: s.repo || s.cwd, sessions: 0, in: 0, out: 0, cr: 0, cc: 0, turns: 0, m: {} });
    r.sessions++; for (const k of ['in', 'out', 'cr', 'cc', 'turns']) r[k] += t[k]; for (const [f, x] of Object.entries(t.m)) { const y = (r.m[f] ||= { in: 0, out: 0, cr: 0, cc: 0 }); for (const k of ['in', 'out', 'cr', 'cc']) y[k] += x[k]; }
    top.push({ id: s.id, title: s.name || s.title || s.first.slice(0, 60), cwd: s.cwd, ...t, cost: costOf(t.m), mtime: s.mtime });
  }
  const tot = x => x.in + x.out + x.cr + x.cc;
  const sk = scanSkills().filter(k => k.src === 'global' || k.src === 'plugin'), chars = sk.reduce((a, k) => a + k.name.length + k.desc.length + 10, 0);
  const cfg = readCfg(); return { prices: prices(), budget: cfg.budget || 0, projects: Object.values(byRepo).map(p => ({ ...p, cost: costOf(p.m) })).sort((a, b) => tot(b) - tot(a)).slice(0, 25), top: top.sort((a, b) => tot(b) - tot(a)).slice(0, 15), overBudget: cfg.budget ? top.filter(x => x.cost > cfg.budget).sort((a, b) => b.cost - a.cost).slice(0, 15) : [],
    skillContext: { skills: sk.length, approxTokens: Math.round(chars / 4), biggest: sk.map(k => ({ name: k.name, src: k.src, approxTokens: Math.round((k.name.length + k.desc.length) / 4) })).sort((a, b) => b.approxTokens - a.approxTokens).slice(0, 8) } };
}
module.exports = { tokenReport, fileTokens, costOf, setPrices };
