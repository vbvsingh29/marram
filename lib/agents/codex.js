'use strict';
// Codex CLI adapter (EXPERIMENTAL: checked against Codex's open-source protocol definitions and a public sample session, not against a live install).
// Sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Lines are { timestamp, type, payload }:
//   session_meta {id, cwd, source, parent_thread_id?}; response_item {type: message | function_call | local_shell_call | custom_tool_call |
//   function_call_output | custom_tool_call_output | reasoning ...}; event_msg {type:'user_message', message}; turn_context; compacted.
//   message.content is [{type:'input_text'|'output_text', text}]; tool outputs are a string or a list of {type:'input_text', text} items.
// Resume: `codex resume <SESSION_ID>` (verified in codex-rs/cli/src/main.rs). Unknown line types are skipped, a half-written last line is ignored.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { HOME, UUID, readTags } = require('../core');
const ROOT = path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'sessions');
const installed = () => { if (fs.existsSync(ROOT)) return true; try { execFileSync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } };
function files(dir = ROOT, depth = 4, out = []) { let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory() && depth > 0) files(p, depth - 1, out); else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(p); } return out; }
const IGNORE = /^(<(environment_context|user_instructions|system-reminder|permissions|turn_aborted|subagent_notification)|# AGENTS\.md instructions)/;
const flat = o => typeof o === 'string' ? o : Array.isArray(o) ? o.map(x => (x && x.text) || '').join('\n') : (o && typeof o === 'object') ? String(o.content ?? o.text ?? JSON.stringify(o)) : '';
function lines(f) { const out = []; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch {} } return out; }
function msgs(o) { // -> [{r:'u'|'a'|'t'|'o', t, ts}]
  const p = o.payload || {}, ts = o.timestamp ? Date.parse(o.timestamp) : 0, out = [];
  if (o.type === 'response_item') {
    if (p.type === 'message') { const t = (p.content || []).map(c => c.text || '').join('\n').trim();
      if (t && p.role === 'user' && !IGNORE.test(t)) out.push({ r: 'u', t: t.slice(0, 6000), ts }); else if (t && p.role === 'assistant') out.push({ r: 'a', t: t.slice(0, 8000), ts }); }
    else if (p.type === 'function_call') out.push({ r: 't', t: (p.name || 'tool') + ' ' + String(p.arguments || '').slice(0, 300), ts });
    else if (p.type === 'custom_tool_call') out.push({ r: 't', t: (p.name || 'tool') + ' ' + String(p.input || '').slice(0, 300), ts });
    else if (p.type === 'local_shell_call') out.push({ r: 't', t: 'shell ' + JSON.stringify(p.action || {}).slice(0, 300), ts });
    else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') out.push({ r: 'o', t: flat(p.output).slice(0, 700), ts });
  }
  return out;
}
const cache = new Map();
function describe(f) {
  const L = lines(f), meta = (L.find(o => o.type === 'session_meta') || {}).payload || {}, M = L.flatMap(msgs), as = M.filter(m => m.r === 'a');
  let us = M.filter(m => m.r === 'u'); if (!us.length) us = L.filter(o => o.type === 'event_msg' && o.payload && o.payload.type === 'user_message' && o.payload.message).map(o => ({ t: String(o.payload.message).slice(0, 6000) }));
  const src = meta.source, sub = !!meta.parent_thread_id || (src && typeof src === 'object' && ('subagent' in src || 'internal' in src));
  return { sub, id: meta.id || (path.basename(f).match(/[0-9a-f-]{36}/i) || [''])[0], cwd: meta.cwd || '', first: (us[0] || {}).t || '', last: (us[us.length - 1] || {}).t || '', lastAssistant: (as[as.length - 1] || {}).t || '' };
}
function list() {
  const tags = readTags(), { repoOf } = require('../sessions'), sessions = [];
  for (const f of files()) {
    let st; try { st = fs.statSync(f); } catch { continue; } let h = cache.get(f); if (!h || h.m !== st.mtimeMs) { try { h = { m: st.mtimeMs, d: describe(f) }; } catch { continue; } cache.set(f, h); }
    const d = h.d; if (!UUID.test(d.id) || d.sub) continue; /* sub-agent threads are not sessions you started */ const t = tags[d.id] || {}, cwd = d.cwd && fs.existsSync(d.cwd) ? d.cwd : (d.cwd || HOME);
    sessions.push({ agent: 'codex', id: d.id, cwd, repo: fs.existsSync(cwd) ? repoOf(cwd) : cwd, title: d.first.slice(0, 100), first: d.first, last: d.last, lastAssistant: d.lastAssistant, ctitle: '', file: f,
      mtime: st.mtimeMs, created: st.birthtimeMs || st.mtimeMs, size: st.size, running: false, status: t.status || 'active', note: t.note || '', name: t.name || '', kind: t.kind || '' });
  }
  return { sessions, liveProcs: 0 };
}
function transcript(id, before, limit) {
  const f = files().find(x => x.includes(id)); if (!f || !UUID.test(id)) return { error: 'session not found' };
  const out = lines(f).flatMap(msgs), end = before > 0 ? Math.min(before, out.length) : out.length, start = Math.max(0, end - limit);
  return { total: out.length, start, msgs: out.slice(start, end) };
}
function diagnose() { // structure summary for bug reports: line types, key names, counts. No message text, paths or ids.
  const fl = files(), types = {}, keys = {}, metaKeys = new Set(); let lines_ = 0, bad = 0, newest = '';
  for (const f of fl.slice(-200)) { let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; } if (f > newest) newest = f;
    for (const l of txt.split('\n')) { if (!l) continue; lines_++; let o; try { o = JSON.parse(l); } catch { bad++; continue; } const p = o.payload && typeof o.payload === 'object' ? o.payload : {}, k = o.type + (p.type ? ':' + p.type : '');
      types[k] = (types[k] || 0) + 1; (keys[k] ||= new Set()); for (const x of Object.keys(p)) keys[k].add(x); if (o.type === 'session_meta') for (const x of Object.keys(p)) metaKeys.add(x); } }
  return { root: ROOT.replace(HOME, '~'), installed: installed(), files: fl.length, lines: lines_, unparsableLines: bad, lineTypes: types, keysByType: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, [...v].sort()])), sessionMetaKeys: [...metaKeys].sort(),
    listed: list().sessions.length, newestFileName: newest ? path.basename(newest).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/i, '<uuid>') : '' };
}
module.exports = { diagnose, id: 'codex', label: 'Codex', experimental: true, note: 'experimental: not yet verified against a real Codex install', installed,
  capabilities: { chat: true, resume: true, newSession: true, worktrees: false, skills: false, vault: true }, list, transcript,
  newCmd: () => ['codex'], resumeCmd: s => ['codex', 'resume', s.id] };
