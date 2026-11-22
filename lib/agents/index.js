'use strict';
// Agent registry. An adapter is:
//   { id, label, installed(): bool,
//     capabilities: { chat, resume, newSession, worktrees, skills, vault },
//     list(): { sessions: [Session], liveProcs },          // Session = { agent, id, cwd, repo, title, first, last, mtime, status, running, bytes, ... }
//     transcript(id, before, limit)?,                      // only if capabilities.chat
//     newCmd(cwd, sid)?, resumeCmd(session)? }             // argv run in a terminal; only if newSession / resume
const ADAPTERS = [require('./claude')];
const cache = new Map(); // installed() can spawn a process: remember for 60 s
function isInstalled(a) { const c = cache.get(a.id); if (c && Date.now() - c.t < 60000) return c.v; const v = !!a.installed(); cache.set(a.id, { t: Date.now(), v }); return v; }
const agents = () => ADAPTERS.map(a => ({ id: a.id, label: a.label, installed: isInstalled(a), capabilities: a.capabilities }));
const get = id => ADAPTERS.find(a => a.id === id);
function sessions(agent) { // merged list from installed agents, optionally one agent
  const out = { sessions: [], liveProcs: 0 };
  for (const a of ADAPTERS) { if (agent && agent !== 'all' && agent !== a.id) continue; if (!isInstalled(a)) continue; const r = a.list(); out.sessions.push(...r.sessions); out.liveProcs += r.liveProcs || 0; }
  out.sessions.sort((x, y) => y.mtime - x.mtime); return out;
}
module.exports = { agents, get, sessions };
