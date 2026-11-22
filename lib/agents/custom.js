'use strict';
// Custom agents: any command-line tool (aider, gemini, opencode, goose, your own script) you add by name and start command.
// Marram runs it in the real terminal in the folder you pick, with your secrets injected. There is no session history for these.
const fs = require('fs'), path = require('path');
const { readCfg, writeCfg } = require('../skills');
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
function parseCommand(line) { // whitespace split with simple "quotes"; no shell is ever involved
  const out = [], re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m; while ((m = re.exec(String(line)))) out.push(m[1] ?? m[2] ?? m[3]); return out;
}
function onPath(cmd) {
  if (!cmd) return false; if (cmd.includes('/')) { try { fs.accessSync(cmd, fs.constants.X_OK); return true; } catch { return false; } }
  return (process.env.PATH || '').split(path.delimiter).some(d => { try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; } catch { return false; } });
}
function adapters() {
  return (readCfg().customAgents || []).map(a => ({ id: a.id, label: a.label, custom: true, note: 'custom command: terminal only, no session history', installed: () => onPath(a.cmd[0]),
    capabilities: { newSession: true, resume: false, chat: false, worktrees: false, skills: false, vault: true }, list: () => ({ sessions: [], liveProcs: 0 }), newCmd: () => a.cmd }));
}
function set({ label, command }) {
  const l = String(label || '').trim().slice(0, 40), cmd = parseCommand(command).slice(0, 30); if (!l) throw new Error('give it a name'); if (!cmd.length) throw new Error('enter the command that starts it');
  if (/[\u0000-\u001f]/.test(cmd.join(' ')) || cmd.join(' ').length > 400) throw new Error('that command contains characters that are not allowed');
  if (/[;&|`$<>]/.test(cmd[0])) throw new Error('enter just the program name first, for example: aider --model x');
  const c = readCfg(), id = 'x-' + (slug(l) || 'agent'), list = (c.customAgents || []).filter(a => a.id !== id);
  if (list.length >= 20) throw new Error('too many custom agents'); if (['x-claude', 'x-codex', 'x-antigravity'].includes(id)) throw new Error('pick a different name');
  list.push({ id, label: l, cmd }); c.customAgents = list; writeCfg(c); return { id };
}
function del(id) { const c = readCfg(); c.customAgents = (c.customAgents || []).filter(a => a.id !== id); writeCfg(c); }
module.exports = { adapters, set, del, parseCommand };
