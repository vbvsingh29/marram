'use strict';
// Export / import of your own organisation data: tags (status, notes, names, types, pins), decisions notes, saved prompts, and settings.
// Never includes the vault (secrets) or any chat content.
const fs = require('fs'), path = require('path');
const { HOME, readTags, writeTags } = require('./core');
const { readCfg, writeCfg } = require('./skills');
const snippets = require('./snippets');
const NOTES = path.join(HOME, '.claude', 'hub-notes.json');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function exportAll() {
  const c = readCfg();
  return { marram: 1, exported: new Date().toISOString(), tags: readTags(), notes: readJ(NOTES, {}), snippets: snippets.read(), settings: { defaults: c.defaults || [], prices: c.prices || {}, budget: c.budget || 0, autoStopMin: c.autoStopMin || 0 } };
}
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
function importAll(b) { // adds what is missing; never overwrites what you already have here
  if (!isObj(b) || b.marram !== 1) throw new Error('not a Marram export file');
  let added = 0;
  const tags = readTags(); for (const [id, t] of Object.entries(isObj(b.tags) ? b.tags : {})) if (/^[\w-]{8,64}$/.test(id) && isObj(t) && !tags[id]) { tags[id] = { ...(t.status && { status: String(t.status).slice(0, 20) }), ...(t.note && { note: String(t.note).slice(0, 2000) }), ...(t.name && { name: String(t.name).slice(0, 200) }), ...(['feature', 'bug', 'chore'].includes(t.kind) && { kind: t.kind }), ...(t.pin && { pin: true }) }; added++; }
  writeTags(tags);
  const notes = readJ(NOTES, {}); for (const [p, t] of Object.entries(isObj(b.notes) ? b.notes : {})) if (!notes[p] && typeof t === 'string') { notes[p] = t.slice(0, 4000); added++; }
  fs.writeFileSync(NOTES, JSON.stringify(notes, null, 2), { mode: 0o600 });
  const sn = snippets.read(); for (const [k, arr] of Object.entries(isObj(b.snippets) ? b.snippets : {})) { if (!Array.isArray(arr)) continue; const have = new Set((sn[k] || []).map(x => x.name)); for (const x of arr.slice(0, 50)) if (x && x.name && x.text && !have.has(x.name)) { (sn[k] ||= []).push({ id: String(x.id || Math.random().toString(16).slice(2, 12)), name: String(x.name).slice(0, 60), text: String(x.text).slice(0, 4000) }); added++; } }
  snippets.write(sn);
  return { added };
}
module.exports = { exportAll, importAll };
