'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync, spawnSync, execFile } = require('child_process');

const HOME = os.homedir(), PROJ = path.join(HOME, '.claude', 'projects');
const TAGS = path.join(HOME, '.claude', 'session-tags.json');
const PORT = +process.env.PORT || 7777;
const IDLE_DAYS = +process.env.IDLE_DAYS || 30;
const JIRA = process.env.JIRA_BASE || '';   // e.g. https://yourco.atlassian.net/browse/
const TICKETS = (process.env.TICKET_PREFIXES || '').split(',').map(x => x.trim()).filter(x => /^[A-Z][A-Z0-9]*$/.test(x)); // e.g. ABC,PROJ
const readTags = () => { try { return JSON.parse(fs.readFileSync(TAGS, 'utf8')); } catch { return {}; } };
const writeTags = t => fs.writeFileSync(TAGS, JSON.stringify(t, null, 2));

function readSlice(fd, size, pos, len) { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b.toString('utf8'); }
const GSAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.sshCommand=false'];
function git(cwd, args, t = 8000) { try { return execFileSync('git', [...GSAFE, ...args], { cwd, timeout: t, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } }
const pexec = (f, a, o = {}) => new Promise(r => execFile(f, a, { timeout: 60000, maxBuffer: 8e6, ...o }, (e, so, se) => r({ e, out: so || '', err: se || '' })));
const okCwd = c => { const r = path.resolve(c || ''); if (!r.startsWith(HOME + path.sep) || !fs.existsSync(r)) throw new Error('cwd missing or outside home'); return r; };
const json = (r, c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const body = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

const TOKF = path.join(HOME, '.claude', 'hub-token');
function hubToken() {
  try { const t = fs.readFileSync(TOKF, 'utf8').trim(); if (t.length >= 32) return t; } catch {}
  const t = require('crypto').randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(TOKF), { recursive: true }); fs.writeFileSync(TOKF, t, { mode: 0o600 }); return t;
}
const TOKEN = hubToken();
module.exports = { TOKEN, GSAFE, HOME, IDLE_DAYS, JIRA, PORT, PROJ, TAGS, TICKETS, UUID, body, git, json, okCwd, pexec, readSlice, readTags, writeTags };
