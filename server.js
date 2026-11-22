#!/usr/bin/env node
// AgentHelm: local-only dashboard for AI coding agent sessions. No deps.
// Layout: lib/core (paths, tags, helpers) <- lib/sessions <- lib/{skills,worktrees,system} <- lib/routes (HTTP) <- this file.
'use strict';
const { PORT, TOKEN } = require('./lib/core');
if (process.argv.includes('--url')) { console.log(`http://127.0.0.1:${PORT}/?k=${TOKEN}`); process.exit(0); }
const si = process.argv.indexOf('--secret');
if (si > 0) { const v = require('./lib/vault').vaultResolve(process.argv[si + 1], (process.argv.indexOf('--project') > 0 && process.argv[process.argv.indexOf('--project') + 1]) || process.cwd()); if (v == null) { console.error('no such secret'); process.exit(1); } process.stdout.write(v); process.exit(0); }
const { server } = require('./lib/routes');
const { backupTags, autoClose, parseSession, transcript, textOf, repoOf } = require('./lib/sessions');
const { okCwd } = require('./lib/core');
if (require.main === module) {
  backupTags(); setInterval(backupTags, 6 * 3600e3);
  setTimeout(() => { try { const n = autoClose(); if (n) console.log('auto-closed', n, 'idle sessions'); } catch (e) { console.log('auto-close failed', e.message); } }, 60e3);
  setInterval(() => { try { autoClose(); } catch {} }, 6 * 3600e3);
  server.listen(PORT, '127.0.0.1', () => { console.log(`AgentHelm on 127.0.0.1:${PORT}.`); console.log(process.stdout.isTTY ? `Open (signs this browser in once): http://127.0.0.1:${PORT}/?k=${TOKEN}` : 'First time in a browser: run  node server.js --url  and open the link.'); });
}
module.exports = { server, okCwd, parseSession, transcript, textOf, repoOf };
