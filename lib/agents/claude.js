'use strict';
// Claude Code adapter: wraps lib/sessions.js (full support).
const { execFileSync } = require('child_process');
const S = require('../sessions');
const installed = () => { if (require('fs').existsSync(require('../core').PROJ)) return true; try { execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } };
module.exports = {
  id: 'claude', label: 'Claude Code', installed,
  capabilities: { changes: true, chat: true, resume: true, newSession: true, worktrees: true, skills: true, vault: true },
  list() { const a = S.allSessions(); return { sessions: a.sessions.map(s => ({ ...s, agent: 'claude' })), liveProcs: a.liveProcs }; },
  transcript: S.transcript,
  newCmd: (cwd, sid) => ['claude', '--session-id', sid],
  resumeCmd: s => ['claude', '--resume', s.id],
};
