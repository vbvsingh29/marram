'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync, spawnSync } = require('child_process');
const { HOME, IDLE_DAYS, JIRA, PROJ, TICKETS, UUID, body, git, json, okCwd, readTags, writeTags } = require('./core');
const { allSessions, autoClose, cache, findFile, gitInfo, handoff, rulesFor, runClaude, safeRulePath, searchTranscripts, sessionChanges, staleSessions, transcript } = require('./sessions');
const { vaultList, vaultSet, vaultGet, vaultDel } = require('./vault');
const { LIB, hype, installPreview, installSelected, projectSkills, readCfg, rulesAudit, scanSkills, resetSkillCache, skillAudit, skillUsage, suggest, writeCfg } = require('./skills');
const { killProc, lsDir, procs, tips } = require('./system');
const { orphanRemove, wtGet, wtRemove } = require('./worktrees');

const crypto = require('crypto');
const { TOKEN } = require('./core');
const sameToken = t => { const a = Buffer.from(String(t || '')), b = Buffer.from(TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };
// Inline script/style are used by the single-file UI; xterm.js comes from jsDelivr, fonts from Google Fonts.
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const terms = new Map(); let termSeq = 0;
const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return json(res, 403, { error: 'bad host' });
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/' && u.searchParams.has('k')) {
    if (!sameToken(u.searchParams.get('k'))) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('bad key'); }
    res.writeHead(302, { 'set-cookie': `hub_tok=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, location: '/' }); return res.end();
  }
  const ck = {}; for (const c of (req.headers.cookie || '').split(/;\s*/)) { const i = c.indexOf('='); if (i > 0) ck[c.slice(0, i)] = c.slice(i + 1); }
  const authed = sameToken(ck.hub_tok);
  if (!authed) { res.writeHead(401, { 'content-type': u.pathname.startsWith('/api/') ? 'application/json' : 'text/plain; charset=utf-8' }); return res.end(u.pathname.startsWith('/api/') ? '{"error":"not signed in"}' : 'Not signed in. Run `node server.js --url` on this machine and open the printed link once.'); }
  try {
    if (req.method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, '..', 'index.html'))); }
    if (u.pathname.startsWith('/api/') && req.headers['x-hub'] !== '1') return json(res, 403, { error: 'missing header' });
    if (req.method === 'GET' && u.pathname === '/api/sessions') return json(res, 200, { ...allSessions(), jira: JIRA, tickets: TICKETS, home: HOME });
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
    if (req.method === 'GET' && u.pathname === '/api/vault') return json(res, 200, vaultList());
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
      if (u.pathname === '/api/skill-uninstall') { const c = readCfg(); if (!c.installed[b.name]) throw new Error('not installed by the hub'); fs.rmSync(path.join(LIB, path.basename(b.name)), { recursive: true, force: true }); delete c.installed[b.name]; c.defaults = c.defaults.filter(x => x !== b.name); writeCfg(c); resetSkillCache(); return json(res, 200, { ok: 1 }); }
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
      if (u.pathname === '/api/vault-set') return json(res, 200, vaultSet(b));
      if (u.pathname === '/api/vault-get') return json(res, 200, vaultGet(b.id));
      if (u.pathname === '/api/vault-del') { vaultDel(b.id); return json(res, 200, { ok: 1 }); }
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
        const tid = 't' + (++termSeq), args = [path.join(__dirname, '..', 'pty-helper.py'), cols, rows, cwd, 'claude', ...(b.id ? ['--resume', sid] : ['--session-id', sid])];
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
});

module.exports = { server, terms };
