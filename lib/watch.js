'use strict';
// Watch: secrets pasted into chats, context size per session, and two sessions touching the same files.
// Everything is read locally from transcripts. Secret VALUES are never stored or returned, only the kind and a count.
const fs = require('fs');
const { findFile, allSessions } = require('./sessions');

const SECRETS = {
  'GitHub token': /\b(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})\b/g,
  'AWS access key': /\bAKIA[0-9A-Z]{16}\b/g,
  'API key (sk-...)': /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/g,
  'Slack token': /\bxox[bpas]-[A-Za-z0-9-]{20,}\b/g,
  'Private key': /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  'Database URL with password': /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/'"@]+:([^@\s'"]{6,})@[\w.-]+/g,
};
const PLACEHOLDER = /^(?:pass(?:word)?|x+|\*+|<.*>|\$\{.*\}|\{.*\}|secret|changeme|your.*|example.*)$/i;
function secretsIn(text) {
  const out = {};
  for (const [kind, re] of Object.entries(SECRETS)) {
    re.lastIndex = 0; const seen = new Set(); let m, n = 0;
    while ((m = re.exec(text)) && n++ < 200) { const v = m[1] || m[0]; if (PLACEHOLDER.test(v) || /xxxx|EXAMPLE|0000000/i.test(v)) continue; seen.add(v); }
    if (seen.size) out[kind] = seen.size;
  }
  return out;
}
function scanText(text) {
  let ctx = 0, model = ''; const i = text.lastIndexOf('"usage":{');
  if (i > 0) { const a = text.lastIndexOf('\n', i) + 1, b = text.indexOf('\n', i); try { const o = JSON.parse(text.slice(a, b < 0 ? undefined : b)), u = (o.message || {}).usage || {}; ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); model = (o.message || {}).model || ''; } catch {} }
  return { secrets: secretsIn(text), compacts: (text.match(/"isCompactSummary":true/g) || []).length, ctx, model };
}

const cache = new Map(); let running = false, progress = { done: 0, total: 0 };
function ensureScan() { // background, in small slices so the server stays responsive
  if (running) return; running = true;
  const todo = []; for (const s of allSessions().sessions) { if (s.agent && s.agent !== 'claude') continue; const h = cache.get(s.id); if (!h || h.m !== s.mtime) todo.push(s); }
  progress = { done: 0, total: todo.length };
  (function step() {
    const t = Date.now();
    while (todo.length && Date.now() - t < 40) { const s = todo.pop(); try { const f = findFile(s.id); if (f) cache.set(s.id, { m: s.mtime, ...scanText(fs.readFileSync(f, 'utf8')) }); } catch {} progress.done++; }
    if (todo.length) setImmediate(step); else running = false;
  })();
}
const CTX_HEAVY = 150000;
function report() {
  ensureScan(); const sess = new Map(allSessions().sessions.map(s => [s.id, s])), secrets = [], context = [];
  for (const [id, h] of cache) { const s = sess.get(id); if (!s) continue; const base = { id, title: s.name || s.title || s.first.slice(0, 60), cwd: s.cwd };
    if (Object.keys(h.secrets).length) secrets.push({ ...base, kinds: h.secrets });
    if (h.ctx >= CTX_HEAVY || h.compacts >= 2) context.push({ ...base, ctx: h.ctx, compacts: h.compacts }); }
  return { scanning: running, progress, secrets: secrets.sort((a, b) => 0), context: context.sort((a, b) => b.ctx - a.ctx), flags: Object.fromEntries([...cache].filter(([id, h]) => Object.keys(h.secrets).length || h.ctx >= CTX_HEAVY || h.compacts >= 2).map(([id, h]) => [id, { secret: Object.keys(h.secrets).length ? 1 : 0, ctx: h.ctx, compacts: h.compacts }])) };
}

const { HOME } = require('./core');
const NOISE = p => p.startsWith('/tmp/') || p.startsWith(HOME + '/.claude/'); // scratch files and Claude's own notes are not real collisions
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
function recentEdits(file, sinceMs) { // files edited in the tail of a transcript
  const out = new Set(); let fd; try { fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size, len = Math.min(size, 3e6), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len);
    for (const l of b.toString('utf8').split('\n')) { if (!l.includes('"tool_use"')) continue; let o; try { o = JSON.parse(l); } catch { continue; } if (o.timestamp && Date.parse(o.timestamp) < sinceMs) continue;
      for (const c of (o.message && Array.isArray(o.message.content)) ? o.message.content : []) if (c.type === 'tool_use' && EDIT.has(c.name) && c.input) { const p = c.input.file_path || c.input.notebook_path; if (p && !NOISE(p)) out.add(p); } } } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  return out;
}
function collisions(now = Date.now()) {
  const active = allSessions().sessions.filter(s => (!s.agent || s.agent === 'claude') && (s.running || now - s.mtime < 30 * 60e3)), byFile = new Map(), byDir = new Map();
  for (const s of active) { const f = findFile(s.id), t = { id: s.id, title: s.name || s.title || s.first.slice(0, 50) };
    if (s.running) (byDir.get(s.cwd) || byDir.set(s.cwd, []).get(s.cwd)).push(t);
    if (f) for (const p of recentEdits(f, now - 6 * 3600e3)) (byFile.get(p) || byFile.set(p, []).get(p)).push(t); }
  return { files: [...byFile].filter(([, l]) => l.length > 1).map(([path, sessions]) => ({ path, sessions })), folders: [...byDir].filter(([, l]) => l.length > 1).map(([cwd, sessions]) => ({ cwd, sessions })) };
}
module.exports = { report, collisions, scanText, secretsIn, CTX_HEAVY };
