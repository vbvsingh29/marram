'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync, spawnSync, execFile } = require('child_process');
const { HOME, git } = require('./core');
const { allSessions, handoff, liveCwds, liveSessions, transcript } = require('./sessions');
const { scanSkills } = require('./skills');

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
module.exports = { killProc, lsDir, procs, tips };
