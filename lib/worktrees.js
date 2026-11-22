'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync, spawnSync, execFile } = require('child_process');
const { HOME, IDLE_DAYS, git } = require('./core');
const { allSessions, liveSessions, mains } = require('./sessions');

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
    else {
      const msg = (g.stderr || 'failed').trim();
      if (/permission denied|EACCES|cannot remove/i.test(msg)) throw new Error('Some files in this worktree are owned by root (usually from Docker or sudo runs), so they cannot be deleted by you. Run this in a terminal, then try again: sudo chown -R "$USER": "' + p + '"');
      throw new Error(msg.slice(0, 200));
    }
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
// New worktree for a task: fetch the base, then `git worktree add -b <branch> ../<repo>-<branch> origin/<base>` (no shell, validated names).
function wtNew(repoDir, branch, base) {
  const repo = require('./core').okCwd(repoDir), b = String(branch || '').trim(), bs = String(base || '').trim();
  if (!/^[\w][\w./-]{0,80}$/.test(b) || !git(repo, ['check-ref-format', '--branch', b])) throw new Error('bad branch name');
  if (!/^[\w][\w./-]{0,80}$/.test(bs)) throw new Error('bad base branch');
  const dest = path.join(path.dirname(repo), path.basename(repo) + '-' + b.replace(/[^\w.-]+/g, '-'));
  if (fs.existsSync(dest)) throw new Error('folder already exists: ' + dest);
  const run = a => { const r = require('child_process').spawnSync('git', [...require('./core').GSAFE, ...a], { cwd: repo, encoding: 'utf8', timeout: 60000 }); if (r.status !== 0) throw new Error((r.stderr || 'git failed').trim().slice(0, 300)); };
  run(['fetch', 'origin', bs]); run(['worktree', 'add', '-b', b, dest, 'origin/' + bs]); return { dir: dest };
}
function defaultBase(repoDir) { const r = require('./core').okCwd(repoDir), n = path.basename(r); if (/^(dms_backend|gsit_proxy|dms_database_sync)$/.test(n)) return 'dev'; return (git(r, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '')) || git(r, ['branch', '--show-current']) || 'main'; }
module.exports = { wtNew, defaultBase, orphanRemove, wtGet, wtRemove };
