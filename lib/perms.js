'use strict';
// Permission helper: which read-only commands did you approve over and over? Suggests allow rules to copy. Never writes settings.
// Each suggested rule is EXACTLY a prefix from this list, so an allow rule never covers more than what was checked here.
// Left out on purpose: find, make, rg, cat, git branch, git fetch, node/npm run with arbitrary scripts (they can run or change things).
const fs = require('fs');
const { findFile, allSessions } = require('./sessions');
const PREFIXES = ['git status', 'git diff', 'git log', 'git show', 'git ls-files', 'git rev-parse', 'git worktree list', 'git stash list', 'git remote -v',
  'ls', 'pwd', 'wc', 'grep', 'stat', 'which', 'date', 'node --check', 'node --test', 'npm test', 'npm run test', 'npm run lint', 'pytest', 'go test', 'go vet', 'cargo test', 'cargo check']
  .sort((a, b) => b.length - a.length);
const match = cmd => { const c = String(cmd).trim(); return PREFIXES.find(p => c === p || c.startsWith(p + ' ')) || null; };
function suggest(repo) {
  const ids = new Set(allSessions().sessions.filter(s => (!s.agent || s.agent === 'claude') && (!repo || s.repo === repo || s.cwd === repo)).map(s => s.id)), counts = {};
  for (const id of ids) { const f = findFile(id); if (!f) continue;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l.includes('"name":"Bash"')) continue; let o; try { o = JSON.parse(l); } catch { continue; }
      for (const c of (o.message && Array.isArray(o.message.content)) ? o.message.content : []) if (c.type === 'tool_use' && c.name === 'Bash' && c.input && c.input.command) {
        const cmd = String(c.input.command); if (/[;&|`$><\n\\]/.test(cmd)) continue; const p = match(cmd); if (p) counts[p] = (counts[p] || 0) + 1; } } }
  const rows = Object.entries(counts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([cmd, n]) => ({ cmd, n, rule: `Bash(${cmd}:*)` }));
  return { sessions: ids.size, rows, snippet: JSON.stringify({ permissions: { allow: rows.map(r => r.rule) } }, null, 2) };
}
module.exports = { suggest, match, PREFIXES };
