'use strict';
// Claude Code adapter: wraps lib/sessions.js (full support).
const { execFileSync } = require('child_process');
const S = require('../sessions');
const installed = () => { if (require('fs').existsSync(require('../core').PROJ)) return true; try { execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } };
module.exports = {
  id: 'claude', label: 'Claude Code', installed,
  capabilities: { destroy: true, changes: true, chat: true, resume: true, newSession: true, worktrees: true, skills: true, vault: true },
  list() { const a = S.allSessions(); return { sessions: a.sessions.map(s => ({ ...s, agent: 'claude' })), liveProcs: a.liveProcs }; },
  transcript: S.transcript,
  newCmd: (cwd, sid) => { const n = require('../notes').noteFor(cwd, S.repoOf(cwd)); return ['claude', '--session-id', sid, ...(n ? ['--append-system-prompt', 'Project decisions to respect (from the user\'s notes):\n' + n] : [])]; },
  resumeCmd: s => ['claude', '--resume', s.id],
};
