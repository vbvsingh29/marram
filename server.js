#!/usr/bin/env node
// Claude Session Hub: local-only dashboard for all Claude Code sessions. No deps.
// Layout: lib/core (paths, tags, helpers) <- lib/sessions <- lib/{skills,worktrees,system} <- lib/routes (HTTP) <- this file.
'use strict';
const { PORT, TOKEN } = require('./lib/core');
if (process.argv.includes('--url')) { console.log(`http://127.0.0.1:${PORT}/?k=${TOKEN}`); process.exit(0); }
const { server } = require('./lib/routes');
const { backupTags, autoClose, parseSession, transcript, textOf, repoOf } = require('./lib/sessions');
const { okCwd } = require('./lib/core');
if (require.main === module) {
  backupTags(); setInterval(backupTags, 6 * 3600e3);
  setTimeout(() => { try { const n = autoClose(); if (n) console.log('auto-closed', n, 'idle sessions'); } catch (e) { console.log('auto-close failed', e.message); } }, 60e3);
  setInterval(() => { try { autoClose(); } catch {} }, 6 * 3600e3);
  server.listen(PORT, '127.0.0.1', () => console.log(`Claude Session Hub on 127.0.0.1:${PORT}. First time in a browser: run  node server.js --url  and open the link.`));
}
module.exports = { server, okCwd, parseSession, transcript, textOf, repoOf };
