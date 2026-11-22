'use strict';
// Small local activity log (what Marram itself did: deletions, auto-stops, imports). No chat text, only titles and counts. Kept to the last 200 entries.
const fs = require('fs'), path = require('path');
const { HOME } = require('./core');
const F = path.join(HOME, '.claude', 'hub-activity.json');
const read = () => { try { const a = JSON.parse(fs.readFileSync(F, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
function log(action, detail) { const a = read(); a.push({ t: Date.now(), action: String(action).slice(0, 60), detail: String(detail || '').slice(0, 160) }); fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(a.slice(-200)), { mode: 0o600 }); }
const recent = (n = 20) => read().slice(-n).reverse();
module.exports = { log, recent };
