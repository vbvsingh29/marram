'use strict';
// Token-level numbers for the Optimize tab, read from Claude transcripts (usage fields). Counts only; no prices, since they change.
const fs = require('fs');
const { findFile, allSessions } = require('./sessions');
const { scanSkills } = require('./skills');
const cache = new Map();
function fileTokens(f) {
  let st; try { st = fs.statSync(f); } catch { return null; }
  const h = cache.get(f); if (h && h.m === st.mtimeMs) return h.v;
  const v = { in: 0, out: 0, cr: 0, cc: 0, turns: 0 }, seen = new Set();
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l.includes('"usage"')) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    const m = o.message; if (!m || !m.usage) continue; const key = (m.id || '') + ':' + (o.requestId || ''); if (m.id && seen.has(key)) continue; seen.add(key);
    const u = m.usage; v.in += u.input_tokens || 0; v.out += u.output_tokens || 0; v.cr += u.cache_read_input_tokens || 0; v.cc += u.cache_creation_input_tokens || 0; v.turns++;
  }
  cache.set(f, { m: st.mtimeMs, v }); return v;
}
function tokenReport() {
  const byRepo = {}, top = [];
  for (const s of allSessions().sessions) {
    const f = findFile(s.id); if (!f) continue; const t = fileTokens(f); if (!t || !t.turns) continue;
    const r = (byRepo[s.repo || s.cwd] ||= { repo: s.repo || s.cwd, sessions: 0, in: 0, out: 0, cr: 0, cc: 0, turns: 0 });
    r.sessions++; for (const k of ['in', 'out', 'cr', 'cc', 'turns']) r[k] += t[k];
    top.push({ id: s.id, title: s.name || s.title || s.first.slice(0, 60), cwd: s.cwd, ...t, mtime: s.mtime });
  }
  const tot = x => x.in + x.out + x.cr + x.cc;
  const sk = scanSkills().filter(k => k.src === 'global' || k.src === 'plugin'), chars = sk.reduce((a, k) => a + k.name.length + k.desc.length + 10, 0);
  return { projects: Object.values(byRepo).sort((a, b) => tot(b) - tot(a)).slice(0, 25), top: top.sort((a, b) => tot(b) - tot(a)).slice(0, 15),
    skillContext: { skills: sk.length, approxTokens: Math.round(chars / 4), biggest: sk.map(k => ({ name: k.name, src: k.src, approxTokens: Math.round((k.name.length + k.desc.length) / 4) })).sort((a, b) => b.approxTokens - a.approxTokens).slice(0, 8) } };
}
module.exports = { tokenReport, fileTokens };
