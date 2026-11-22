'use strict';
// Antigravity adapter (read-only list). Its chats (conversations/*.pb) are binary, so we only show what is readable:
// the notes Antigravity writes per conversation in brain/<id>/*.md (+ .metadata.json summaries). No chat viewer, no resume.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { HOME, okCwd, readTags } = require('../core');
const ROOT = path.join(HOME, '.gemini', 'antigravity'), CONV = path.join(ROOT, 'conversations'), BRAIN = path.join(ROOT, 'brain');
const PATHRE = new RegExp(HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/projects/[\\w.-]+', 'g');
const installed = () => fs.existsSync(CONV);
const cache = new Map();
const noteFiles = d => { try { return fs.readdirSync(d).filter(f => f.endsWith('.md')).map(f => path.join(d, f)); } catch { return []; } };
const readSome = (f, n = 200000) => { try { const fd = fs.openSync(f, 'r'); try { const b = Buffer.alloc(Math.min(n, fs.fstatSync(fd).size)); fs.readSync(fd, b, 0, b.length, 0); return b.toString('utf8'); } finally { fs.closeSync(fd); } } catch { return ''; } };
function describe(id, bd) {
  const files = noteFiles(bd), pick = ['implementation_plan.md', 'task.md', 'walkthrough.md'].map(n => files.find(f => path.basename(f) === n)).find(Boolean) || files[0];
  let title = '', summary = '', updated = 0; const paths = {};
  if (pick) {
    const t = readSome(pick, 20000), m = t.match(/^#\s+(.+)$/m); title = m ? m[1].trim().slice(0, 120) : '';
    try { const md = JSON.parse(fs.readFileSync(pick + '.metadata.json', 'utf8')); summary = String(md.summary || '').slice(0, 500); } catch {}
  }
  for (const f of files) { try { updated = Math.max(updated, fs.statSync(f).mtimeMs); } catch {} for (const m of readSome(f).matchAll(PATHRE)) paths[m[0]] = (paths[m[0]] || 0) + 1; }
  const best = Object.entries(paths).sort((a, b) => b[1] - a[1]).map(x => x[0]).find(p => fs.existsSync(p));
  return { title, summary, updated, cwd: best || '' };
}
function list() {
  const tags = readTags(), { repoOf } = require('../sessions'); let ids = []; try { ids = fs.readdirSync(CONV).filter(f => f.endsWith('.pb')).map(f => f.slice(0, -3)); } catch {}
  const sessions = [];
  for (const id of ids) {
    let st; try { st = fs.statSync(path.join(CONV, id + '.pb')); } catch { continue; }
    const bd = path.join(BRAIN, id); let bm = 0; try { bm = fs.statSync(bd).mtimeMs; } catch {}
    const key = st.mtimeMs + ':' + bm; let h = cache.get(id); if (!h || h.key !== key) { h = { key, d: describe(id, bd) }; cache.set(id, h); }
    const d = h.d, t = tags[id] || {}, cwd = d.cwd || ROOT, mtime = Math.max(st.mtimeMs, d.updated);
    sessions.push({ agent: 'antigravity', id, cwd, repo: d.cwd ? repoOf(cwd) : cwd, title: d.title || 'Antigravity · ' + new Date(mtime).toISOString().slice(0, 16).replace('T', ' '), first: d.summary || d.title, last: '', lastAssistant: d.summary, ctitle: d.title,
      mtime, created: st.birthtimeMs || st.mtimeMs, size: st.size, running: false, status: t.status || 'active', note: t.note || '', name: t.name || d.title || '', kind: t.kind || '' });
  }
  return { sessions, liveProcs: 0 };
}
function openFolder(cwd) { const c = spawn('antigravity', [okCwd(cwd)], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); }
module.exports = { id: 'antigravity', label: 'Antigravity', note: 'read-only: titles and summaries from its notes; chats are not readable', installed,
  capabilities: { chat: false, resume: false, newSession: false, worktrees: false, skills: false, vault: false, openFolder: true }, list, openFolder };
