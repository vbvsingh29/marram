'use strict';
// Per-project "decisions" note, kept in ~/.claude/hub-notes.json (never inside the repo). New sessions started from the hub
// get it appended to the system prompt, so agreed decisions survive worktree switches and fresh sessions.
const fs = require('fs'), path = require('path');
const { HOME, okCwd, cleanText } = require('./core');
const F = path.join(HOME, '.claude', 'hub-notes.json'), MAX = 4000;
const read = () => { try { return JSON.parse(fs.readFileSync(F, 'utf8')); } catch { return {}; } };
const getNote = project => read()[path.resolve(project || '')] || '';
function setNote(project, text) {
  const p = okCwd(project), all = read(), t = cleanText(text).slice(0, MAX).trim();
  if (t) all[p] = t; else delete all[p];
  fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(all, null, 2), { mode: 0o600 }); return t;
}
const noteFor = (...dirs) => { for (const d of dirs) { const n = d && getNote(d); if (n) return n; } return ''; };
module.exports = { getNote, setNote, noteFor, MAX };
