#!/usr/bin/env node
// Claude Session Hub: local-only dashboard for all Claude Code sessions. No deps.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync, spawnSync } = require('child_process');
const HOME = os.homedir(), PROJ = path.join(HOME, '.claude', 'projects');
const TAGS = path.join(HOME, '.claude', 'session-tags.json');
const PORT = +process.env.PORT || 7777;
const IDLE_DAYS = +process.env.IDLE_DAYS || 30;
const JIRA = process.env.JIRA_BASE || '';   // e.g. https://yourco.atlassian.net/browse/
const TICKETS = (process.env.TICKET_PREFIXES || '').split(',').map(x => x.trim()).filter(x => /^[A-Z][A-Z0-9]*$/.test(x)); // e.g. ABC,PROJ
const cache = new Map(), ctCache = new Map();

const readTags = () => { try { return JSON.parse(fs.readFileSync(TAGS, 'utf8')); } catch { return {}; } };
const writeTags = t => fs.writeFileSync(TAGS, JSON.stringify(t, null, 2));

function readSlice(fd, size, pos, len) { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b.toString('utf8'); }
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
        if (pid != process.pid && (exe === 'claude' || (exe === 'node' && /claude/.test(cmd[1] || '') && !/claude-session-hub/.test(cmd[1] || '')))) out.push({ pid, cwd: fs.readlinkSync(`/proc/${pid}/cwd`), resume: cmd.includes('--resume') ? cmd[cmd.indexOf('--resume') + 1] : '' });
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
    const c = spawn('claude', args, { cwd: wd, stdio: ['pipe', 'pipe', 'pipe'] });
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
const GSAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.sshCommand=false'];
function git(cwd, args, t = 8000) { try { return execFileSync('git', [...GSAFE, ...args], { cwd, timeout: t, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } }
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
const { execFile } = require('child_process');
const pexec = (f, a, o = {}) => new Promise(r => execFile(f, a, { timeout: 60000, maxBuffer: 8e6, ...o }, (e, so, se) => r({ e, out: so || '', err: se || '' })));
const CFG = path.join(HOME, '.claude', 'hub-config.json'), LIB = path.join(HOME, '.claude', 'hub-skills'), CACHE = path.join(HOME, '.claude', 'hub-cache');
const readCfg = () => { try { return { defaults: [], installed: {}, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) }; } catch { return { defaults: [], installed: {} }; } };
const writeCfg = c => fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
const fm = f => { let t = ''; try { t = fs.readFileSync(f, 'utf8').slice(0, 6000); } catch { return {}; }
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/), g = k => { const x = m && m[1].match(new RegExp('^' + k + ':\\s*(.*)$', 'm')); return x ? x[1].replace(/^["'>|-]+|["']+$/g, '').trim() : ''; };
  return { name: g('name'), desc: g('description') || (t.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('#')) || '').trim(), body: t }; };
function walkSkills(root, src, depth, out) {
  if (depth < 0) return; let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  if (ents.some(e => e.name === 'SKILL.md')) { const m = fm(path.join(root, 'SKILL.md')); out.push({ name: m.name || path.basename(root), desc: (m.desc || '').slice(0, 300), src, dir: root }); return; }
  for (const e of ents) if ((e.isDirectory() || e.isSymbolicLink()) && !['node_modules', '.git'].includes(e.name)) walkSkills(path.join(root, e.name), src, depth - 1, out);
}
let skCache = { t: 0, v: [] };
function scanSkills() {
  if (Date.now() - skCache.t < 20000) return skCache.v;
  const out = [];
  walkSkills(path.join(HOME, '.claude', 'skills'), 'global', 2, out);
  walkSkills(LIB, 'library', 2, out);
  const pl = path.join(HOME, '.claude', 'plugins');
  try { for (const d of fs.readdirSync(pl)) { if (['cache', 'marketplaces', 'data', 'repos'].includes(d)) walkSkills(path.join(pl, d), 'plugin', 7, out); } } catch {}
  const seen = new Set(), res = [];
  for (const k of out) { const key = k.src + ':' + k.name; if (!seen.has(key)) { seen.add(key); res.push(k); } }
  skCache = { t: Date.now(), v: res }; return res;
}
const usageCache = new Map();
function fileUsage(p) {
  let st; try { st = fs.statSync(p); } catch { return {}; }
  let h = usageCache.get(p);
  if (!h || h.m !== st.mtimeMs) { const c = {}; for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.includes('"name":"Skill"')) continue; let o; try { o = JSON.parse(l); } catch { continue; } const ct = o.message && o.message.content; if (Array.isArray(ct)) for (const b of ct) if (b.type === 'tool_use' && b.name === 'Skill' && b.input && b.input.skill) c[b.input.skill] = (c[b.input.skill] || 0) + 1; } h = { m: st.mtimeMs, c }; usageCache.set(p, h); }
  return h.c;
}
function skillUsage(filter) {
  const tot = {};
  for (const d of fs.readdirSync(PROJ)) { let fl; try { fl = fs.readdirSync(path.join(PROJ, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of fl) { if (filter && !filter(f.slice(0, -6))) continue; for (const [k, v] of Object.entries(fileUsage(path.join(PROJ, d, f)))) tot[k] = (tot[k] || 0) + v; } }
  return tot;
}
const okCwd = c => { const r = path.resolve(c || ''); if (!r.startsWith(HOME + path.sep) || !fs.existsSync(r)) throw new Error('cwd missing or outside home'); return r; };
function projectSkills(cwd) {
  const d = path.join(okCwd(cwd), '.claude', 'skills'); let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch {}
  return ents.map(e => ({ name: e.name, link: e.isSymbolicLink(), dir: path.join(d, e.name) }));
}
const STOP = new Set('this that with from have will your what when then they them were been about into just like make also need want please should would could there their which where while these those some more other than only very can not and the for you are but all any'.split(' '));
const toks = t => [...new Set((String(t).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter(w => !STOP.has(w)))];
function suggest(id, cwd) {
  const f = findFile(id); if (!f) return [];
  const s = parseSession(f), q = new Set(toks([s.title, s.first, s.last, s.lastAssistant, path.basename(s.cwd)].join(' ')));
  const all = scanSkills().filter(k => k.src !== 'global'), df = {}; const docs = all.map(k => { const t = toks(k.name.replace(/[-_]/g, ' ') + ' ' + k.desc); t.forEach(w => df[w] = (df[w] || 0) + 1); return t; });
  const have = new Set(projectSkills(cwd || s.cwd).map(x => x.name));
  return all.map((k, i) => ({ k, sc: docs[i].reduce((a, w) => a + (q.has(w) ? 1 / Math.log(2 + df[w]) : 0), 0), hit: docs[i].filter(w => q.has(w)).slice(0, 4) }))
    .filter(x => x.sc > 0.4 && !have.has(x.k.name)).sort((a, b) => b.sc - a.sc).slice(0, 6).map(x => ({ name: x.k.name, src: x.k.src, desc: x.k.desc, why: x.hit.join(', ') }));
}
function procs() {
  const LS = liveSessions();
  const up = parseFloat(fs.readFileSync('/proc/uptime', 'utf8')), now = Date.now(), all = allSessions().sessions, res = [];
  for (const p of liveCwds()) {
    let rss = 0, age = 0; try { rss = +(fs.readFileSync(`/proc/${p.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/) || [])[1] * 1024 || 0; const st = fs.readFileSync(`/proc/${p.pid}/stat`, 'utf8'); age = up - (+st.slice(st.lastIndexOf(')') + 2).split(' ')[19]) / 100; } catch {}
    const ls = LS.find(l => l.pid === String(p.pid)), own = ls && all.find(s => s.id === ls.id);
    const last = own ? own.mtime : Math.max(0, ...all.filter(s => s.cwd === p.cwd).map(s => s.mtime));
    res.push({ pid: p.pid, cwd: p.cwd, title: own ? (own.name || own.title) : '', rss, age, lastActive: last, idleMin: last ? Math.round((now - last) / 60000) : null, busy: last && now - last < 900000 });
  }
  return res.sort((a, b) => b.rss - a.rss);
}
function tips() {
  const t = [], sk = scanSkills();
  const g = (() => { try { return fs.statSync(path.join(HOME, '.claude', 'CLAUDE.md')).size; } catch { return 0; } })();
  const pc = (() => { try { return fs.statSync(path.join(HOME, 'projects', 'CLAUDE.md')).size; } catch { return 0; } })();
  if (g + pc > 6000) t.push(`CLAUDE.md files total ${((g + pc) / 1024).toFixed(1)} KB; every session loads them. Trim rules you no longer need.`);
  const gl = sk.filter(k => k.src === 'global').length, pl = sk.filter(k => k.src === 'plugin').length;
  if (gl + pl > 25) t.push(`${gl + pl} skills are loaded (${gl} global, ${pl} from plugins). Each adds its description to every session's context. Disable unused plugins and keep rarely used skills in the hub library, enabled per project.`);
  const big = allSessions().sessions.filter(s => s.size > 5e6).length;
  if (big) t.push(`${big} session transcript(s) over 5 MB. Resuming these loads a lot of context; start a fresh session for new work.`);
  t.push('Close idle claude processes below. Sessions stay on disk and resume with claude --resume.');
  t.push('Use /compact in long sessions, and /clear between unrelated tasks.');
  return t;
}
// hyped
const hypeCache = {};
async function ghSearch(q) {
  const params = ['search/repositories', '-X', 'GET', '-f', 'q=' + q, '-f', 'sort=stars', '-f', 'order=desc', '-f', 'per_page=20'];
  let r = await pexec('gh', ['api', ...params], { timeout: 20000 }); let j;
  try { j = JSON.parse(r.out); } catch {}
  if (!j || !j.items) { try { const x = await fetch('https://api.github.com/search/repositories?' + new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: '20' }), { headers: { 'user-agent': 'session-hub', accept: 'application/vnd.github+json' } }); j = await x.json(); } catch (e) { return { error: String(e) }; } }
  if (!j.items) return { error: j.message || 'github search failed (rate limit?)' };
  return j.items.map(i => ({ name: i.full_name, desc: i.description || '', stars: i.stargazers_count, url: i.html_url, lang: i.language || '', pushed: i.pushed_at }));
}
const HCATS = { frontend: ['frontend', 'react', 'vue', 'nextjs', 'css'], backend: ['backend', 'api', 'nodejs', 'fastapi', 'django'], ui: ['ui', 'design', 'ux', 'tailwind', 'figma'], security: ['security', 'vulnerability', 'pentest', 'audit', 'owasp'], quality: ['code-review', 'refactor', 'lint', 'clean-code', 'simplify'], testing: ['testing', 'tdd', 'playwright', 'jest', 'pytest'], devops: ['devops', 'docker', 'kubernetes', 'aws', 'cloudflare'], data: ['database', 'sql', 'postgres', 'analytics', 'data-science'], ai: ['agent', 'llm', 'mcp', 'prompt', 'rag'], mobile: ['mobile', 'ios', 'android', 'flutter', 'react-native'], docs: ['documentation', 'writing', 'markdown', 'docs'], productivity: ['productivity', 'workflow', 'automation', 'planning'], git: ['git', 'github', 'pull-request', 'commit', 'changelog'] };
async function hype(kind, cat, q) {
  q = String(q || '').replace(/[^\w .-]/g, ' ').trim().slice(0, 60); cat = HCATS[cat] ? cat : '';
  const key = kind + '|' + cat + '|' + q, h = hypeCache[key]; if (h && Date.now() - h.t < 600000) return h.v;
  const kw = (cat ? '(' + HCATS[cat].join(' OR ') + ') ' : '') + (q ? q + ' ' : '') + (cat || q ? 'in:name,description,topics ' : '');
  let v;
  if (kind === 'skills') {
    const qs = (cat || q ? ['topic:claude-skills', 'topic:claude-code'] : ['topic:claude-skills', 'topic:claude-code-skills', 'topic:agent-skills', 'topic:claude-code']).map(t => kw + t);
    const rs = await Promise.all(qs.map(ghSearch)), seen = new Map();
    for (const r of rs) if (Array.isArray(r)) for (const i of r) if (!seen.has(i.name)) seen.set(i.name, i);
    v = seen.size ? [...seen.values()].sort((a, b) => b.stars - a.stars).slice(0, 30) : (rs.some(r => r.error) ? { error: (rs.find(r => r.error) || {}).error } : []);
  } else {
    const d = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    v = await ghSearch(kw + 'created:>' + d + ' stars:>' + (cat || q ? 10 : 50));
  }
  if (Array.isArray(v)) hypeCache[key] = { t: Date.now(), v };
  return v;
}
const REPO = /^[\w.-]+\/[\w.-]+$/;
async function installPreview(repo) {
  if (!REPO.test(repo)) throw new Error('bad repo name');
  const dir = path.join(CACHE, repo.replace('/', '__')); fs.mkdirSync(CACHE, { recursive: true }); fs.rmSync(dir, { recursive: true, force: true });
  const r = await pexec('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--no-recurse-submodules', '--', 'https://github.com/' + repo + '.git', dir], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.e) throw new Error('clone failed: ' + (r.err || r.e.message).slice(0, 200));
  const found = []; walkSkills(dir, 'x', 4, found);
  return found.map(k => {
    const files = []; (function w(d, dep) { if (dep > 3) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) w(p, dep + 1); else files.push(path.relative(k.dir, p)); } })(k.dir, 0);
    return { name: k.name, desc: k.desc, rel: path.relative(dir, k.dir), excerpt: fm(path.join(k.dir, 'SKILL.md')).body.slice(0, 1500), scripts: files.filter(f => /\.(sh|py|js|ts|rb|pl|exe|bin)$/i.test(f)), fileCount: files.length };
  });
}
function installSelected(repo, rels) {
  if (!REPO.test(repo)) throw new Error('bad repo name');
  const root = path.join(CACHE, repo.replace('/', '__')), cfg = readCfg(), done = [];
  fs.mkdirSync(LIB, { recursive: true });
  for (const rel of rels) {
    const src = path.resolve(root, rel); if (!src.startsWith(root + path.sep) || !fs.existsSync(path.join(src, 'SKILL.md'))) continue;
    const name = (fm(path.join(src, 'SKILL.md')).name || path.basename(src)).replace(/[^\w.-]/g, '-').slice(0, 60), dest = path.join(LIB, name);
    if (fs.existsSync(dest)) { done.push({ name, skipped: 'already installed' }); continue; }
    fs.cpSync(src, dest, { recursive: true, filter: p => path.basename(p) !== '.git' });
    cfg.installed[name] = repo; done.push({ name }); }
  writeCfg(cfg); skCache.t = 0; return done;
}
function killProc(pid, force) {
  const p = procs().find(x => String(x.pid) === String(pid)); if (!p) throw new Error('not a claude process');
  if (p.busy && !force) throw new Error('busy (active in last 15 min); confirm to close');
  process.kill(+p.pid, 'SIGTERM'); return { freed: p.rss };
}

function lsDir(d) {
  const r = path.resolve(d || HOME);
  if (r !== HOME && !r.startsWith(HOME + path.sep)) throw new Error('outside home');
  const cnt = {}; for (const x of allSessions().sessions) cnt[x.cwd] = (cnt[x.cwd] || 0) + 1;
  let ents = []; try { ents = fs.readdirSync(r, { withFileTypes: true }); } catch (e) { throw new Error('cannot read: ' + e.code); }
  const dirs = ents.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').slice(0, 400).map(e => { const p = path.join(r, e.name); return { name: e.name, git: fs.existsSync(path.join(p, '.git')), claudemd: fs.existsSync(path.join(p, 'CLAUDE.md')), sessions: cnt[p] || 0 }; }).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  return { dir: r, home: HOME, parent: r === HOME ? null : path.dirname(r), dirs, git: fs.existsSync(path.join(r, '.git')), claudemd: fs.existsSync(path.join(r, 'CLAUDE.md')), sessions: cnt[r] || 0 };
}

// ---- v2: live sessions, backups, auto-close, search, worktrees, handoff, audits ----
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
function wtRows() {
  const live = liveSessions(), lastBy = {}; for (const s of allSessions().sessions) lastBy[s.cwd] = Math.max(lastBy[s.cwd] || 0, s.mtime);
  const rows = [], seen = new Set(), now = Date.now();
  for (const m of mains()) {
    let cur = {};
    for (const l of (git(m, ['worktree', 'list', '--porcelain'], 20000) + '\n').split('\n')) {
      if (l) { const k = l.split(' ')[0]; cur[k] = l.slice(k.length + 1) || true; continue; }
      const w = cur.worktree; cur = {};
      if (!w || w === m || seen.has(w)) continue; seen.add(w);
      if (!fs.existsSync(w)) { rows.push({ repo: m, path: w, missing: true, eligible: false, state: 'missing' }); continue; }
      const ct = (+git(w, ['log', '-1', '--format=%ct']) || 0) * 1000, dirty = git(w, ['status', '--porcelain']).split('\n').filter(Boolean).length, unpushed = +git(w, ['rev-list', '--count', 'HEAD', '--not', '--remotes']) || 0;
      const last = Math.max(ct, lastBy[w] || 0), days = last ? Math.floor((now - last) / 864e5) : 9999, running = live.some(x => x.cwd === w || (x.cwd || '').startsWith(w + '/'));
      const branch = git(w, ['branch', '--show-current']) || '(detached)';
      const state = running ? 'running' : dirty ? 'dirty' : unpushed ? 'unpushed' : days < IDLE_DAYS ? 'recent' : 'eligible';
      rows.push({ repo: m, path: w, branch, days, dirty, unpushed, running, eligible: state === 'eligible', state });
    }
  }
  const orphans = []; (function w(d, dep) { if (dep > 3) return; let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (e.some(x => x.name === '.git' && x.isFile())) { try { const m = fs.readFileSync(path.join(d, '.git'), 'utf8').match(/gitdir: (.*)/); if (m && !fs.existsSync(m[1].trim())) orphans.push(d); } catch {} return; }
    if (e.some(x => x.name === '.git')) return;
    for (const x of e) if (x.isDirectory() && !x.name.startsWith('.') && !['node_modules', 'venv'].includes(x.name)) w(path.join(d, x.name), dep + 1); })(path.join(HOME, 'projects'), 0);
  return { rows: rows.sort((a, b) => (b.days || 0) - (a.days || 0)), orphans, idleDays: IDLE_DAYS };
}
let wtCache = { t: 0, v: null };
const wtGet = fresh => { if (fresh || !wtCache.v || Date.now() - wtCache.t > 60000) wtCache = { t: Date.now(), v: wtRows() }; return wtCache.v; };
function wtRemove(p, force, delBranch) {
  const row = wtGet(true).rows.find(r => r.path === p); if (!row) throw new Error('not a known worktree');
  if (row.state === 'running') throw new Error('a Claude session is running in it; close that first');
  if (!force && !row.eligible && !row.missing) throw new Error('not eligible (' + row.state + '); use force remove');
  const g = spawnSync('git', ['-C', row.repo, 'worktree', 'remove', ...(force || row.missing ? ['--force'] : []), p], { encoding: 'utf8', timeout: 300000 });
  if (g.status !== 0) {
    if (row.missing) { spawnSync('git', ['-C', row.repo, 'worktree', 'prune'], { encoding: 'utf8' }); }
    else throw new Error((g.stderr || 'failed').trim().slice(0, 200));
  }
  let branchMsg = '';
  if (delBranch && row.branch && row.branch !== '(detached)') {
    const d = spawnSync('git', ['-C', row.repo, 'branch', '-d', row.branch], { encoding: 'utf8' });
    branchMsg = d.status === 0 ? 'branch deleted' : 'branch kept (not fully merged)';
  }
  wtCache.t = 0; return { ok: 1, branchMsg };
}
function orphanRemove(p) {
  const o = wtGet(true).orphans; if (!o.includes(p)) throw new Error('not a known orphan');
  fs.rmSync(p, { recursive: true, force: true });
  if (fs.existsSync(p)) throw new Error('root-owned files remain; run: sudo rm -rf "' + p + '"');
  wtCache.t = 0; return { ok: 1 };
}
function handoff(id) {
  const f = findFile(id); if (!f) return 'session not found'; const s = parseSession(f), c = sessionChanges(id), name = readTags()[id]?.name || s.ctitle || s.title || s.first.slice(0, 80);
  const br = fs.existsSync(s.cwd) ? git(s.cwd, ['branch', '--show-current']) : '';
  return [`# Handoff: ${name}`, `Folder: ${s.cwd}${br ? ' (branch ' + br + ')' : ''}`, `Started: ${new Date(s.created).toISOString()}  Last active: ${new Date(s.mtime).toISOString()}`,
    `Resume: cd "${s.cwd}" && claude --resume ${id}`, '', `## First ask`, s.first, '', `## Last ask`, s.last, '', `## Last reply`, s.lastAssistant, '',
    `## Files changed (${c.files.length})`, ...c.files.slice(0, 30).map(x => `- ${x.path}`), '', `## Commits (${c.commits.length})`, ...c.commits.map(x => `- ${x.hash} ${x.msg}`), '', `## PRs`, ...(c.prs.length ? c.prs.map(x => `- ${x}`) : ['- none'])].join('\n');
}
function skillAudit(repo) {
  const ids = new Set(allSessions().sessions.filter(s => s.repo === repo || s.cwd === repo).map(s => s.id));
  const inRepo = skillUsage(id => ids.has(id)), all = skillUsage(), sk = scanSkills(), have = new Set(projectSkills(repo).map(x => x.name));
  const rows = [...new Set([...Object.keys(inRepo), ...have])].map(n => ({ name: n, uses: inRepo[n] || 0, enabledHere: have.has(n), src: (sk.find(k => k.name === n) || {}).src || '?' })).sort((a, b) => b.uses - a.uses);
  return { sessions: ids.size, rows, unusedEnabled: rows.filter(r => r.enabledHere && !r.uses).map(r => r.name), globalNeverUsed: sk.filter(k => k.src === 'global' && !all[k.name]).map(k => k.name) };
}
function rulesAudit(cwd) {
  const R = rulesFor(cwd), seen = {}, dups = [];
  for (const r of R) for (const l of new Set(r.content.split('\n').map(x => x.trim().toLowerCase()).filter(x => x.length > 30))) (seen[l] ||= []).push(r.path);
  for (const [l, ps] of Object.entries(seen)) if (ps.length > 1) dups.push({ line: l.slice(0, 120), in: ps });
  return { files: R.map(r => ({ path: r.path, bytes: Buffer.byteLength(r.content) })), total: R.reduce((a, r) => a + Buffer.byteLength(r.content), 0), dups: dups.slice(0, 15) };
}
backupTags(); setInterval(backupTags, 6 * 3600e3);
setTimeout(() => { try { const n = autoClose(); if (n) console.log('auto-closed', n, 'idle sessions'); } catch (e) { console.log('auto-close failed', e.message); } }, 5000);
setInterval(() => { try { autoClose(); } catch {} }, 6 * 3600e3);

const json = (r, c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };

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
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const terms = new Map(); let termSeq = 0;
const body = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return json(res, 403, { error: 'bad host' });
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }
    if (u.pathname.startsWith('/api/') && req.headers['x-hub'] !== '1') return json(res, 403, { error: 'missing header' });
    if (req.method === 'GET' && u.pathname === '/api/sessions') return json(res, 200, { ...allSessions(), jira: JIRA, tickets: TICKETS });
    if (req.method === 'GET' && u.pathname === '/api/ls') return json(res, 200, lsDir(u.searchParams.get('dir')));
    if (req.method === 'GET' && u.pathname === '/api/skills') { const cfg = readCfg(), use = skillUsage(); return json(res, 200, scanSkills().map(k => ({ ...k, dir: undefined, isDefault: cfg.defaults.includes(k.name), uses: use[k.name] || 0, from: cfg.installed[k.name] || '' }))); }
    if (req.method === 'GET' && u.pathname === '/api/project-skills') return json(res, 200, projectSkills(u.searchParams.get('cwd')).map(x => ({ name: x.name, link: x.link })));
    if (req.method === 'GET' && u.pathname === '/api/suggest') return json(res, 200, suggest(u.searchParams.get('id') || '', u.searchParams.get('cwd') || ''));
    if (req.method === 'GET' && u.pathname === '/api/procs') { const p = procs(); return json(res, 200, { procs: p, tips: tips(), total: p.reduce((a, x) => a + x.rss, 0), mem: (() => { const m = fs.readFileSync('/proc/meminfo', 'utf8'); const g = k => +(m.match(new RegExp(k + ':\\s+(\\d+)')) || [])[1] * 1024; return { total: g('MemTotal'), avail: g('MemAvailable') }; })() }); }
    if (req.method === 'GET' && u.pathname === '/api/hype') return json(res, 200, await hype(u.searchParams.get('kind') === 'repos' ? 'repos' : 'skills', u.searchParams.get('cat'), u.searchParams.get('q')));
    if (req.method === 'GET' && u.pathname === '/api/search') return json(res, 200, searchTranscripts(u.searchParams.get('q') || ''));
    if (req.method === 'GET' && u.pathname === '/api/worktrees') return json(res, 200, wtGet(u.searchParams.get('fresh') === '1'));
    if (req.method === 'GET' && u.pathname === '/api/du') { const p = u.searchParams.get('path') || ''; if (!wtGet().rows.some(r => r.path === p)) return json(res, 404, { error: 'unknown' }); const o = require('child_process').spawnSync('du', ['-sk', p], { encoding: 'utf8', timeout: 30000 }); return json(res, 200, { kb: parseInt(o.stdout) || 0 }); }
    if (req.method === 'GET' && u.pathname === '/api/handoff') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(handoff(u.searchParams.get('id') || '')); }
    if (req.method === 'GET' && u.pathname === '/api/skill-audit') return json(res, 200, skillAudit(u.searchParams.get('repo') || ''));
    if (req.method === 'GET' && u.pathname === '/api/rules-audit') return json(res, 200, rulesAudit(u.searchParams.get('cwd') || HOME));
    if (req.method === 'GET' && u.pathname === '/api/auto-close-preview') return json(res, 200, { n: staleSessions().length, days: IDLE_DAYS });
    if (req.method === 'GET' && u.pathname === '/api/changes') return json(res, 200, sessionChanges(u.searchParams.get('id') || ''));
    if (req.method === 'GET' && u.pathname === '/api/git') return json(res, 200, gitInfo(u.searchParams.get('cwd') || ''));
    if (req.method === 'GET' && u.pathname === '/api/rules') return json(res, 200, rulesFor(u.searchParams.get('cwd') || HOME));
    if (req.method === 'GET' && u.pathname === '/api/transcript') return json(res, 200, transcript(u.searchParams.get('id') || '', +u.searchParams.get('before') || 0, Math.min(500, +u.searchParams.get('limit') || 120)));
    if (req.method === 'GET' && u.pathname === '/api/terms') return json(res, 200, [...terms.values()].map(t => ({ tid: t.tid, sid: t.sid, cwd: t.cwd, alive: t.alive, started: t.started })));
    if (req.method === 'POST') {
      if (req.headers['x-hub'] !== '1') return json(res, 403, { error: 'missing header' });
      const b = await body(req);
      if (u.pathname === '/api/mkdir') { const par = okCwd(b.parent); if (!/^[\w][\w. -]{0,80}$/.test(b.name || '')) throw new Error('bad folder name'); const p = path.join(par, b.name); fs.mkdirSync(p); return json(res, 200, { dir: p }); }
      if (u.pathname === '/api/skill-add') { const cwd = okCwd(b.cwd), k = scanSkills().find(x => x.name === b.name && x.src !== 'global'); if (!k) throw new Error('skill not found (global skills already apply everywhere)'); const d = path.join(cwd, '.claude', 'skills'); fs.mkdirSync(d, { recursive: true }); const dest = path.join(d, k.name.replace(/[^\w.-]/g, '-')); if (!fs.existsSync(dest)) fs.symlinkSync(k.dir, dest, 'dir'); return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/skill-remove') { const cwd = okCwd(b.cwd), dest = path.join(cwd, '.claude', 'skills', path.basename(b.name || '')); const st = fs.lstatSync(dest); if (!st.isSymbolicLink()) throw new Error('not a hub-managed link; remove it by hand'); fs.unlinkSync(dest); return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/skill-default') { const c = readCfg(); c.defaults = c.defaults.filter(x => x !== b.name); if (b.on) c.defaults.push(b.name); writeCfg(c); return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/skill-defaults-top') { const use = skillUsage(), c = readCfg(); c.defaults = scanSkills().filter(k => k.src !== 'global').map(k => k.name).filter((n, i, a) => a.indexOf(n) === i && use[n]).sort((a, b2) => use[b2] - use[a]).slice(0, 5); writeCfg(c); return json(res, 200, c.defaults); }
      if (u.pathname === '/api/apply-defaults') { const cwd = okCwd(b.cwd), c = readCfg(), added = []; for (const n of c.defaults) { const k = scanSkills().find(x => x.name === n && x.src !== 'global'); if (!k) continue; const d = path.join(cwd, '.claude', 'skills'); fs.mkdirSync(d, { recursive: true }); const dest = path.join(d, n.replace(/[^\w.-]/g, '-')); if (!fs.existsSync(dest)) { fs.symlinkSync(k.dir, dest, 'dir'); added.push(n); } } return json(res, 200, { added }); }
      if (u.pathname === '/api/skill-uninstall') { const c = readCfg(); if (!c.installed[b.name]) throw new Error('not installed by the hub'); fs.rmSync(path.join(LIB, path.basename(b.name)), { recursive: true, force: true }); delete c.installed[b.name]; c.defaults = c.defaults.filter(x => x !== b.name); writeCfg(c); skCache.t = 0; return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/install-preview') return json(res, 200, await installPreview(b.repo));
      if (u.pathname === '/api/install') return json(res, 200, installSelected(b.repo, b.rels || []));
      if (u.pathname === '/api/kill') return json(res, 200, killProc(b.pid, b.force));
      if (u.pathname === '/api/kill-idle') { let n = 0, freed = 0; for (const p of procs().filter(x => !x.busy)) { try { process.kill(+p.pid, 'SIGTERM'); n++; freed += p.rss; } catch {} } return json(res, 200, { closed: n, freed }); }
      if (u.pathname === '/api/auto-close') return json(res, 200, { n: autoClose() });
      if (u.pathname === '/api/wt-remove') return json(res, 200, wtRemove(b.path, !!b.force, !!b.deleteBranch));
      if (u.pathname === '/api/wt-remove-many') { const out = []; for (const pth of (b.paths || []).slice(0, 300)) { try { const r = wtRemove(pth, !!b.force, !!b.deleteBranch); out.push({ path: pth, ok: 1, note: r.branchMsg }); } catch (e) { out.push({ path: pth, error: e.message }); } } return json(res, 200, out); }
      if (u.pathname === '/api/wt-remove-eligible') { let ok = 0; const errs = []; for (const r of wtGet(true).rows.filter(x => x.eligible)) { try { wtRemove(r.path); ok++; } catch (e) { errs.push(r.path.split('/').pop() + ': ' + e.message); } } return json(res, 200, { removed: ok, errors: errs.slice(0, 10), failed: errs.length }); }
      if (u.pathname === '/api/orphan-remove') return json(res, 200, orphanRemove(b.path));
      if (u.pathname === '/api/tag') { const t = readTags(); t[b.id] = { ...(t[b.id] || {}), ...(b.status !== undefined && { status: b.status }), ...(b.note !== undefined && { note: b.note }), ...(b.name !== undefined && { name: b.name }) }; writeTags(t); return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/rules') { fs.writeFileSync(safeRulePath(b.path), b.content); return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/send') return json(res, 200, await runClaude(b.cwd, b.id, b.prompt));
      if (u.pathname === '/api/term-start') {
        const sid = b.id ? String(b.id) : require('crypto').randomUUID();
        if (b.id && !UUID.test(sid)) throw new Error('bad id');
        let cwd;
        if (b.id && b.cwd && !fs.existsSync(b.cwd)) {
          const old = path.resolve(b.cwd), alt = old.replace(HOME + '/projects/backup/', HOME + '/projects/');
          let sug = fs.existsSync(alt) ? alt : old; while (!fs.existsSync(sug) || sug === path.dirname(sug)) { sug = path.dirname(sug); if (sug.length <= HOME.length) { sug = HOME; break; } }
          if (!b.fallback) return json(res, 200, { error: 'The folder this session ran in no longer exists: ' + old, suggest: sug });
          cwd = okCwd(b.fallback);
          const src = findFile(sid), dd = path.join(PROJ, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
          if (src) { fs.mkdirSync(dd, { recursive: true }); const dst = path.join(dd, sid + '.jsonl'); if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); }
        } else cwd = okCwd(b.cwd);
        for (const [tid, t] of terms) if (t.alive && t.sid === sid) return json(res, 200, { tid, sid, reused: 1 });
        const cols = Math.min(400, Math.max(20, +b.cols || 120)), rows = Math.min(200, Math.max(5, +b.rows || 32));
        const tid = 't' + (++termSeq), args = [path.join(__dirname, 'pty-helper.py'), cols, rows, cwd, 'claude', ...(b.id ? ['--resume', sid] : ['--session-id', sid])];
        const proc = spawn('python3', args, { stdio: ['pipe', 'pipe', 'ignore'] });
        const t = { tid, sid, cwd, proc, chunks: [], size: 0, clients: new Set(), alive: true, started: Date.now() };
        proc.stdout.on('data', d => { t.chunks.push(d); t.size += d.length; while (t.size > 400000 && t.chunks.length > 1) t.size -= t.chunks.shift().length; for (const c of t.clients) c.write(d); });
        proc.stdin.on('error', () => {});
        proc.on('close', code => { t.alive = false; t.code = code; for (const c of t.clients) c.end(); t.clients.clear(); });
        proc.on('error', () => { t.alive = false; });
        terms.set(tid, t);
        return json(res, 200, { tid, sid });
      }
      if (u.pathname === '/api/term-out') {
        const t = terms.get(b.tid); if (!t) return json(res, 404, { error: 'no such terminal' });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        for (const c of t.chunks) res.write(c);
        if (!t.alive) return res.end();
        t.clients.add(res); res.on('close', () => t.clients.delete(res)); return;
      }
      if (u.pathname === '/api/term-in') { const t = terms.get(b.tid); if (!t || !t.alive) return json(res, 404, { error: 'not running' }); t.proc.stdin.write(JSON.stringify({ d: String(b.d || '') }) + '\n'); return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/term-resize') { const t = terms.get(b.tid); if (t && t.alive) t.proc.stdin.write(JSON.stringify({ r: [Math.min(400, +b.cols || 120), Math.min(200, +b.rows || 32)] }) + '\n'); return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/term-kill') { const t = terms.get(b.tid); if (t) { try { t.proc.stdin.end(); setTimeout(() => t.alive && t.proc.kill(), 1500); } catch {} if (b.forget) terms.delete(b.tid); } return json(res, 200, { ok: 1 }); }
      if (u.pathname === '/api/send-stream') {
        if (b.id && !UUID.test(String(b.id))) throw new Error('bad session id');
        const wd = okCwd(b.cwd), args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
        if (b.id) args.unshift('--resume', String(b.id));
        if (['acceptEdits', 'plan'].includes(b.mode)) args.push('--permission-mode', b.mode);
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        const c = spawn('claude', args, { cwd: wd, stdio: ['pipe', 'pipe', 'pipe'] });
        c.stdin.on('error', () => {}); c.stdin.end(String(b.prompt || ''));
        c.stdout.on('data', d => res.write(d));
        c.stderr.on('data', d => res.write(JSON.stringify({ type: 'hub_stderr', text: String(d) }) + '\n'));
        const to = setTimeout(() => c.kill(), 600000);
        c.on('close', code => { clearTimeout(to); res.end(JSON.stringify({ type: 'hub_done', code }) + '\n'); });
        c.on('error', e => { res.end(JSON.stringify({ type: 'hub_stderr', text: String(e) }) + '\n'); });
        res.on('close', () => { if (c.exitCode === null) c.kill(); });
        return;
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Claude Session Hub: http://127.0.0.1:${PORT}`));
