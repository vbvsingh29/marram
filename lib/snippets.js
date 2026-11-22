'use strict';
// Saved prompts: global and per project, in ~/.claude/hub-snippets.json. They are inserted into a terminal (never sent automatically).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { HOME, okCwd } = require('./core');
const F = path.join(HOME, '.claude', 'hub-snippets.json'), MAX_TEXT = 4000, MAX_EACH = 50;
const read = () => { try { const o = JSON.parse(fs.readFileSync(F, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const write = o => { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(o, null, 2), { mode: 0o600 }); };
const scopeKey = s => (!s || s === 'global') ? 'global' : okCwd(s);
function list(cwd) { const all = read(); return { global: all.global || [], project: cwd ? (all[path.resolve(cwd)] || []) : [] }; }
function set({ scope, id, name, text }) {
  const k = scopeKey(scope), all = read(), arr = all[k] || [], n = String(name || '').trim().slice(0, 60), t = String(text || '').slice(0, MAX_TEXT);
  if (!n || !t.trim()) throw new Error('name and text are required');
  let it = id && arr.find(x => x.id === id); if (!it) { if (arr.length >= MAX_EACH) throw new Error('too many saved prompts here'); it = { id: crypto.randomBytes(5).toString('hex') }; arr.push(it); }
  it.name = n; it.text = t; all[k] = arr; write(all); return { id: it.id };
}
function del({ scope, id }) { const k = scopeKey(scope), all = read(); all[k] = (all[k] || []).filter(x => x.id !== id); write(all); }
module.exports = { list, set, del, read, write, F };
