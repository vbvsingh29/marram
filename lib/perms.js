'use strict';
// Permission helper: which read-only commands did you approve over and over? Suggests EXACT-command allow rules to copy (no wildcards).
// Never writes settings. Left out on purpose: anything that runs project code (test runners, npm/node scripts, make, cargo, go) and
// anything with flags or arguments outside a small allowlist (see tokenOk).
const fs = require('fs');
const { findFile, allSessions } = require('./sessions');
const PREFIXES = ['git status', 'git diff', 'git log', 'git show', 'git ls-files', 'git rev-parse', 'git worktree list', 'git stash list', 'git remote -v',
  'ls', 'pwd', 'wc', 'grep', 'stat', 'which', 'date'].sort((a, b) => b.length - a.length);
// Strict allowlist, not a denylist: a command is suggested only if every token is plainly safe. Long flags must be in SAFE_LONG (so abbreviations like
// --out for --output never pass), short flags may not contain o O c e x f, and arguments may only use a plain character set (no quotes, globs, ':' or braces).
const SAFE_LONG = new Set(['--stat', '--oneline', '--short', '--name-only', '--name-status', '--cached', '--staged', '--porcelain', '--no-color', '--graph', '--decorate', '--shortstat', '--numstat', '--summary', '--branch']);
const ARG = /^[A-Za-z0-9._/@,+=~^-]+$/, VAL = /^[A-Za-z0-9._/,+-]*$/;
function tokenOk(t) {
  if (t.startsWith('--')) { const [n, ...v] = t.split('='); return SAFE_LONG.has(n) && (!v.length || VAL.test(v.join('='))); }
  if (t.startsWith('-')) return /^-[A-Za-z0-9]{1,6}$/.test(t) && !/[oOcexf]/.test(t);
  return ARG.test(t);
}
const match = cmd => {
  const c = String(cmd).trim().replace(/\s+/g, ' '), pre = PREFIXES.find(p => c === p || c.startsWith(p + ' ')); if (!pre) return null;
  return c.slice(pre.length).split(' ').filter(Boolean).every(tokenOk) ? c : null;
};
function suggest(repo) {
  const ids = new Set(allSessions().sessions.filter(s => (!s.agent || s.agent === 'claude') && (!repo || s.repo === repo || s.cwd === repo)).map(s => s.id)), counts = {};
  for (const id of ids) { const f = findFile(id); if (!f) continue;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l.includes('"name":"Bash"')) continue; let o; try { o = JSON.parse(l); } catch { continue; }
      for (const c of (o.message && Array.isArray(o.message.content)) ? o.message.content : []) if (c.type === 'tool_use' && c.name === 'Bash' && c.input && c.input.command) {
        const cmd = String(c.input.command); if (/[;&|`$><\n\\]/.test(cmd)) continue; const p = match(cmd); if (p) counts[p] = (counts[p] || 0) + 1; /* p is the exact command */ } } }
  const rows = Object.entries(counts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([cmd, n]) => ({ cmd, n, rule: `Bash(${cmd})` }));
  return { sessions: ids.size, rows, snippet: JSON.stringify({ permissions: { allow: rows.map(r => r.rule) } }, null, 2) };
}
module.exports = { suggest, match, PREFIXES };
