'use strict';
// Attach: the browser cannot hand a pasted screenshot or a dropped file to a terminal program, so Marram saves it to a private folder
// on this computer and gives the program its path (Claude Code and Codex read images and documents from a path).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { HOME } = require('./core');
const DIR = path.join(HOME, '.claude', 'hub-attachments'), MAX = 25 * 1024 * 1024;
const OK = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'xml', 'html', 'docx', 'xlsx', 'pptx']);
function safeName(n) { // keep a readable name, drop paths and odd characters, force an allowed extension
  const base = path.basename(String(n || 'file')).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-60) || 'file';
  const ext = (base.split('.').pop() || '').toLowerCase();
  if (!base.includes('.') || !OK.has(ext)) throw new Error('This file type is not supported. Allowed: images, PDF, text, CSV, JSON, Word, Excel, PowerPoint.');
  return base;
}
function save(req, name) {
  return new Promise((resolve, reject) => {
    let nm; try { nm = safeName(name); } catch (e) { req.resume(); return reject(e); }
    if (+req.headers['content-length'] > MAX) { req.resume(); return reject(new Error('That file is larger than 25 MB.')); }
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const file = path.join(DIR, crypto.randomBytes(4).toString('hex') + '-' + nm), out = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
    let n = 0, bad = null;
    req.on('data', d => { n += d.length; if (n > MAX && !bad) { bad = new Error('That file is larger than 25 MB.'); out.destroy(); } });
    req.on('error', e => { out.destroy(); fs.rm(file, { force: true }, () => {}); reject(e); });
    out.on('error', e => { fs.rm(file, { force: true }, () => {}); reject(bad || e); });
    out.on('finish', () => n ? resolve({ path: file, name: nm, size: n }) : (fs.rm(file, { force: true }, () => {}), reject(new Error('The file was empty.'))));
    req.pipe(out);
  });
}
module.exports = { save, safeName, DIR, MAX };
