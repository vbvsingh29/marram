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
const goodDir = p => { try { return require('./core').okCwd(p); } catch { return ''; } };
// Adds what is missing; never overwrites what you already have here. Notes and saved prompts become part of agent instructions, so keys are
// validated like the live endpoints (a real folder under your home) and text is cleaned. dry=true only previews, so you can review before importing.
function importAll(b, dry) {
  if (!isObj(b) || b.marram !== 1) throw new Error('not a Marram export file');
  const { cleanText } = require('./core'), preview = { tags: 0, notes: [], snippets: [] };
  const tags = readTags(); for (const [id, t] of Object.entries(isObj(b.tags) ? b.tags : {})) if (/^[\w-]{8,64}$/.test(id) && isObj(t) && !tags[id]) { tags[id] = { ...(t.status && { status: cleanText(t.status).slice(0, 20) }), ...(t.note && { note: cleanText(t.note).slice(0, 2000) }), ...(t.name && { name: cleanText(t.name).slice(0, 200) }), ...(['feature', 'bug', 'chore'].includes(t.kind) && { kind: t.kind }), ...(t.pin && { pin: true }) }; preview.tags++; }
  const notes = readJ(NOTES, {}); for (const [p0, t] of Object.entries(isObj(b.notes) ? b.notes : {})) { const p = goodDir(p0); if (p && !notes[p] && typeof t === 'string' && cleanText(t).trim()) { notes[p] = cleanText(t).slice(0, 4000); preview.notes.push({ path: p, text: notes[p] }); } }
  const sn = snippets.read(); for (const [k0, arr] of Object.entries(isObj(b.snippets) ? b.snippets : {})) { const k = k0 === 'global' ? 'global' : goodDir(k0); if (!k || !Array.isArray(arr)) continue; const have = new Set((sn[k] || []).map(x => x.name));
    for (const x of arr.slice(0, 50)) { const n = cleanText(x && x.name).trim().slice(0, 60), t = cleanText(x && x.text).slice(0, 4000); if (n && t.trim() && !have.has(n)) { (sn[k] ||= []).push({ id: Math.random().toString(16).slice(2, 12), name: n, text: t }); have.add(n); preview.snippets.push({ scope: k, name: n, text: t }); } } }
  const added = preview.tags + preview.notes.length + preview.snippets.length;
  if (dry) return { added, preview };
  writeTags(tags); fs.writeFileSync(NOTES, JSON.stringify(notes, null, 2), { mode: 0o600 }); snippets.write(sn);
  return { added };
}
module.exports = { exportAll, importAll };
