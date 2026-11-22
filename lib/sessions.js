'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync, spawnSync, execFile } = require('child_process');
const { HOME, IDLE_DAYS, PROJ, TAGS, UUID, git, json, okCwd, readSlice, readTags, writeTags } = require('./core');

const cache = new Map(), ctCache = new Map();

function textOf(o) {
  const c = o.message && o.message.content;
  let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : '';
  t = t.trim();
  return (!t || t.startsWith('<') || o.isMeta) ? '' : t;
}
function parseSession(file) {
  const st = fs.statSync(file), key = file + st.mtimeMs, hit = cache.get(file);
  if (hit && hit.key === key) return hit.val;
  const fd = fs.openSync(file, 'r');
  const head = readSlice(fd, st.size, 0, Math.min(st.size, 200000));
  const tailLen = Math.min(st.size, 400000);
  const tail = readSlice(fd, st.size, st.size - tailLen, tailLen);
  fs.closeSync(fd);
  const v = { id: path.basename(file, '.jsonl'), mtime: st.mtimeMs, size: st.size, cwd: '', created: 0, title: '', first: '', last: '', lastAssistant: '' };
  for (const l of head.split('\n')) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!v.created && o.timestamp) v.created = Date.parse(o.timestamp) || 0;
    if (!v.cwd && o.cwd) v.cwd = o.cwd;
    if (!v.first && o.type === 'user') v.first = textOf(o);
    if (v.cwd && v.first && v.created) break;
  }
  for (const l of tail.split('\n')) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'ai-title' && o.aiTitle) v.title = o.aiTitle;
    if (o.type === 'custom-title' && o.customTitle) v.ctitle = o.customTitle;
    if (o.type === 'user') { const t = textOf(o); if (t) v.last = t; }
    if (o.type === 'assistant') { const t = textOf(o); if (t) v.lastAssistant = t; }
  }
  if (!v.ctitle && ctCache.has(file)) v.ctitle = ctCache.get(file);
  if (!v.ctitle && !ctCache.has(file) && st.size > tailLen) { // not in tail: scan whole file once
    for (const l of fs.readFileSync(file, 'utf8').split('\n')) { if (!l.includes('"custom-title"')) continue; try { const o = JSON.parse(l); if (o.customTitle) v.ctitle = o.customTitle; } catch {} }
  }
  ctCache.set(file, v.ctitle || '');
  v.ctitle = v.ctitle || '';
  v.first = v.first.slice(0, 300); v.last = v.last.slice(0, 300); v.lastAssistant = v.lastAssistant.slice(0, 400);
  cache.set(file, { key, val: v });
  return v;
}
function liveCwds() { // cwd + pid of running claude processes
  const out = [];
  try {
    for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
        const exe = path.basename(cmd[0] || '');
        if (pid != process.pid && (exe === 'claude' || (exe === 'node' && /claude/.test(cmd[1] || '') && !/(claude-session-hub|agenthelm)/.test(cmd[1] || '')))) out.push({ pid, cwd: fs.readlinkSync(`/proc/${pid}/cwd`), resume: cmd.includes('--resume') ? cmd[cmd.indexOf('--resume') + 1] : '' });
      } catch {}
    }
  } catch {}
  return out;
}
function rulesFor(cwd) { // CLAUDE.md from cwd up to HOME's parent chain
  const res = []; let d = cwd;
  for (let i = 0; i < 6 && d && d !== '/'; i++, d = path.dirname(d)) {
    const f = path.join(d, 'CLAUDE.md');
    if (fs.existsSync(f)) res.push({ path: f, content: fs.readFileSync(f, 'utf8') });
    if (d === HOME) break;
  }
  const g = path.join(HOME, '.claude', 'CLAUDE.md');
  if (fs.existsSync(g) && !res.find(r => r.path === g)) res.push({ path: g, content: fs.readFileSync(g, 'utf8') });
  return res;
}
const repoCache = new Map(); let mainsCache = { t: 0, v: [] };
const nrm = x => x.toLowerCase().replace(/_/g, '-');
function mains() {
  if (Date.now() - mainsCache.t < 120000) return mainsCache.v;
  const out = []; (function w(d, dep) { if (dep > 3) return; let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (e.some(x => x.name === '.git' && x.isDirectory())) { out.push(d); return; }
    for (const x of e) if (x.isDirectory() && !x.name.startsWith('.') && !['node_modules', 'venv', '.venv'].includes(x.name)) w(path.join(d, x.name), dep + 1); })(path.join(HOME, 'projects'), 0);
  mainsCache = { t: Date.now(), v: out }; return out;
}
function repoOf(cwd) {
  const h = repoCache.get(cwd); if (h && Date.now() - h.t < 120000) return h.v;
  let r = '';
  if (cwd.startsWith('-')) { const cw = cwd.replace('-projects-backup-', '-projects-'); const m = mains().filter(x => cw === x.replace(/[\/._]/g, '-') || cw.startsWith(x.replace(/[\/._]/g, '-') + '-')).sort((a, b) => b.length - a.length)[0]; if (m) { repoCache.set(cwd, { t: Date.now(), v: m }); return m; } }
  if (fs.existsSync(cwd)) { try { const c = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (c.endsWith('/.git')) r = path.dirname(c); } catch {} }
  if (!r) { // deleted worktree: match by name against known main repos
    const parts = cwd.split('/').filter(Boolean), base = nrm(parts[parts.length - 1] || ''), par = nrm(parts[parts.length - 2] || '');
    let best = '';
    for (const m of mains()) { const n = nrm(path.basename(m)); if ((base === n || base.startsWith(n + '-') || par === n + '-worktrees' || par.startsWith(n + '-')) && n.length > best.length) { best = n; r = m; } }
  }
  repoCache.set(cwd, { t: Date.now(), v: r || cwd }); return r || cwd;
}

const st0 = s => s.mtime;
function allSessions() {
  const tags = readTags(), live = liveCwds(), now = Date.now(), list = [], liveIds = new Set(liveSessions().map(x => x.id));
  for (const dir of fs.readdirSync(PROJ)) {
    const dp = path.join(PROJ, dir);
    let files; try { files = fs.readdirSync(dp).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      let s; try { s = parseSession(path.join(dp, f)); } catch { continue; }
      if (!s.cwd) s.cwd = dir;
      const t = tags[s.id] || {};
      const running = liveIds.has(s.id) || live.some(p => p.resume === s.id);
      list.push({ ...s, repo: repoOf(s.cwd), running, created: s.created || st0(s), status: t.status || 'active', note: t.note || '', name: t.name || s.ctitle || '' });
    }
  }
  return { sessions: list.sort((a, b) => b.mtime - a.mtime), liveProcs: live.length };
}
function safeRulePath(p) {
  const r = path.resolve(p);
  if (path.basename(r) !== 'CLAUDE.md' || !r.startsWith(HOME + path.sep)) throw new Error('only CLAUDE.md under home allowed');
  return r;
}
function runClaude(cwd, id, prompt) {
  return new Promise(res => {
    if (id && !UUID.test(String(id))) return res({ code: -1, out: '', err: 'bad session id' });
    const args = ['-p']; if (id) args.unshift('--resume', String(id));
    let wd; try { wd = okCwd(cwd); } catch { wd = HOME; }
    const c = spawn('claude', args, { cwd: wd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...require('./vault').vaultEnv(wd, repoOf(wd)) } });
    c.stdin.on('error', () => {}); c.stdin.end(String(prompt || ''));
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    const to = setTimeout(() => c.kill(), 600000);
    c.on('close', code => { clearTimeout(to); res({ code, out, err }); });
    c.on('error', e => res({ code: -1, out: '', err: String(e) }));
  });
}


// ---- code changes ----
const chCache = new Map();
function findFile(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  for (const d of fs.readdirSync(PROJ)) { const f = path.join(PROJ, d, id + '.jsonl'); if (fs.existsSync(f)) return f; }
  return null;
}
function sessionChanges(id) {
  const f = findFile(id); if (!f) return { files: [], commits: [], prs: [] };
  const st = fs.statSync(f), hit = chCache.get(id);
  if (hit && hit.m === st.mtimeMs) return hit.v;
  const files = {}, commits = [], prs = new Set(), seen = new Set();
  const txt = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : '';
  const scan = (t, ts) => {
    for (const m of t.matchAll(/https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull|bitbucket\.org\/[\w.-]+\/[\w.-]+\/pull-requests)\/\d+/g)) prs.add(m[0]);
    for (const m of t.matchAll(/\[([\w\-\/.]+) ([0-9a-f]{7,12})\] ([^\n]*)/g)) if (!seen.has(m[2])) { seen.add(m[2]); commits.push({ branch: m[1], hash: m[2], msg: m[3], ts }); }
  };
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l.includes('"type":"assistant"') && !l.includes('"type":"user"')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0, c = o.message && o.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'tool_use' && b.input) {
        const p = b.input.file_path || b.input.notebook_path;
        if (p && /^(Edit|Write|NotebookEdit|MultiEdit)$/.test(b.name)) { const e = files[p] || (files[p] = { path: p, edits: 0, writes: 0, last: 0 }); b.name === 'Write' ? e.writes++ : e.edits++; e.last = ts; }
      } else if (b.type === 'tool_result') scan(txt(b.content), ts);
      else if (b.type === 'text' && o.type === 'assistant') for (const m of (b.text || '').matchAll(/https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull|bitbucket\.org\/[\w.-]+\/[\w.-]+\/pull-requests)\/\d+/g)) prs.add(m[0]);
    }
  }
  const v = { files: Object.values(files).sort((a, b) => b.last - a.last), commits, prs: [...prs] };
  chCache.set(id, { m: st.mtimeMs, v }); return v;
}
function gitInfo(cwd) {
  const r = path.resolve(cwd);
  if (!r.startsWith(HOME + path.sep) || !fs.existsSync(r)) return { error: 'cwd missing or outside home' };
  if (!git(r, ['rev-parse', '--git-dir'])) return { error: 'not a git repo' };
  const branch = git(r, ['branch', '--show-current']);
  let remote = git(r, ['remote', 'get-url', 'origin']).replace(/^git@(github\.com|bitbucket\.org):/, 'https://$1/').replace(/^https:\/\/[^@\/]+@/, 'https://').replace(/\.git$/, '');
  if (!/^https:\/\/(github\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+$/.test(remote)) remote = '';
  const log = git(r, ['log', '-20', '--format=%h|%an|%ar|%s']).split('\n').filter(Boolean).map(x => { const [h, a, d, ...m] = x.split('|'); return { hash: h, author: a, when: d, msg: m.join('|') }; });
  const status = git(r, ['status', '--short']).split('\n').filter(Boolean);
  let prs = [];
  if (branch) { try { prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,title,url,state', '-L', '5'], { cwd: r, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch {} }
  return { branch, remote, host: /bitbucket/.test(remote) ? 'bb' : 'gh', log, status, prs };
}

// ---- skills, optimize, hyped ----
function liveSessions() {
  const out = [], dir = path.join(HOME, '.claude', 'sessions'); let fl = []; try { fl = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)); } catch {}
  for (const f of fl) { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), pid = String(j.pid); if (/claude/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'))) out.push({ pid, id: j.sessionId, cwd: j.cwd, kind: j.kind }); } catch {} }
  return out;
}
const BK = path.join(HOME, '.claude', 'hub-backups');
function backupTags() {
  try { fs.mkdirSync(BK, { recursive: true }); const f = path.join(BK, 'session-tags-' + new Date().toISOString().slice(0, 10) + '.json');
    if (fs.existsSync(TAGS) && !fs.existsSync(f)) fs.copyFileSync(TAGS, f);
    const all = fs.readdirSync(BK).filter(x => x.startsWith('session-tags-')).sort(); for (const x of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(BK, x)); } catch {}
}
function staleSessions() {
  const t = readTags(), now = Date.now();
  return allSessions().sessions.filter(s => !s.running && !(t[s.id] && t[s.id].status) && now - s.mtime >= IDLE_DAYS * 864e5);
}
function autoClose() {
  const st = staleSessions(); if (!st.length) return 0; backupTags(); const t = readTags();
  for (const s of st) t[s.id] = { ...(t[s.id] || {}), status: 'done', auto: true, note: (t[s.id] && t[s.id].note) || `auto-closed: idle ${IDLE_DAYS}+ days` };
  writeTags(t); return st.length;
}
function searchTranscripts(q) {
  q = q.toLowerCase().trim(); if (q.length < 3) return [];
  const res = [];
  for (const d of fs.readdirSync(PROJ)) { let fl; try { fl = fs.readdirSync(path.join(PROJ, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of fl) {
      const p = path.join(PROJ, d, f); let raw; try { raw = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const low = raw.toLowerCase(); let i = low.indexOf(q), hits = [], n = 0;
      while (i !== -1 && n < 400) { n++;
        const ls = raw.lastIndexOf('\n', i) + 1; let le = raw.indexOf('\n', i); if (le < 0) le = raw.length;
        const line = raw.slice(ls, le);
        if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) { try { const o = JSON.parse(line), c = o.message && o.message.content, t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : ''; const k = t.toLowerCase().indexOf(q); if (k >= 0 && hits.length < 3) hits.push({ who: o.type, text: t.slice(Math.max(0, k - 80), k + 160).replace(/\s+/g, ' ') }); } catch {} }
        i = low.indexOf(q, le);
      }
      if (hits.length) { let s; try { s = parseSession(p); } catch { continue; } res.push({ id: s.id, title: s.ctitle || s.title || s.first.slice(0, 80), cwd: s.cwd, repo: repoOf(s.cwd), mtime: s.mtime, hits }); }
    } }
  return res.sort((a, b) => b.mtime - a.mtime).slice(0, 40);
}
function handoff(id) {
  const f = findFile(id); if (!f) return 'session not found'; const s = parseSession(f), c = sessionChanges(id), name = readTags()[id]?.name || s.ctitle || s.title || s.first.slice(0, 80);
  const br = fs.existsSync(s.cwd) ? git(s.cwd, ['branch', '--show-current']) : '';
  return [`# Handoff: ${name}`, `Folder: ${s.cwd}${br ? ' (branch ' + br + ')' : ''}`, `Started: ${new Date(s.created).toISOString()}  Last active: ${new Date(s.mtime).toISOString()}`,
    `Resume: cd "${s.cwd}" && claude --resume ${id}`, '', `## First ask`, s.first, '', `## Last ask`, s.last, '', `## Last reply`, s.lastAssistant, '',
    `## Files changed (${c.files.length})`, ...c.files.slice(0, 30).map(x => `- ${x.path}`), '', `## Commits (${c.commits.length})`, ...c.commits.map(x => `- ${x.hash} ${x.msg}`), '', `## PRs`, ...(c.prs.length ? c.prs.map(x => `- ${x}`) : ['- none'])].join('\n');
}
function transcript(id, before, limit) {
  const f = findFile(id); if (!f) return { error: 'session not found' };
  const out = [], txt = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : '';
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.isMeta || o.isSidechain || !o.message) continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0, c = o.message.content;
    if (o.type === 'user') {
      if (typeof c === 'string') { if (!/^<(command-|local-command|system-reminder)/.test(c.trim())) out.push({ r: 'u', t: c.slice(0, 6000), ts }); }
      else for (const x of c || []) {
        if (x.type === 'text' && x.text && !/^<(command-|local-command|system-reminder)/.test(x.text.trim())) out.push({ r: 'u', t: x.text.slice(0, 6000), ts });
        else if (x.type === 'tool_result') out.push({ r: x.is_error ? 'e' : 'o', t: txt(x.content).slice(0, 700), ts });
      }
    } else if (o.type === 'assistant') {
      for (const x of c || []) {
        if (x.type === 'text' && x.text && x.text.trim()) out.push({ r: 'a', t: x.text.slice(0, 8000), ts });
        else if (x.type === 'tool_use') out.push({ r: 't', t: x.name + ' ' + JSON.stringify(x.input || {}).slice(0, 300), ts });
      }
    }
  }
  const end = before > 0 ? Math.min(before, out.length) : out.length, start = Math.max(0, end - limit);
  return { total: out.length, start, msgs: out.slice(start, end) };
}
module.exports = { allSessions, autoClose, backupTags, cache, findFile, gitInfo, handoff, liveCwds, liveSessions, mains, parseSession, repoOf, rulesFor, runClaude, safeRulePath, searchTranscripts, sessionChanges, staleSessions, textOf, transcript };
