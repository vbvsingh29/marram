'use strict';
// Secrets vault: ~/.claude/hub-vault.json (mode 0600), plaintext at rest like ~/.git-credentials.
// List APIs never return values; reveal is an explicit POST. Scope = 'global' or an absolute project dir.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { HOME, okCwd } = require('./core');
const VF = path.join(HOME, '.claude', 'hub-vault.json');
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// Names that change how a process loads code or runs: never allowed as secrets, never injected.
const BLOCK = /^(LD_|DYLD_|NODE_|PYTHON|PERL|RUBY|GIT_|BASH_|CLAUDE|ANTHROPIC_|NPM_|XDG_)|^(PATH|HOME|SHELL|ENV|IFS|PWD|USER|TERM|GCONV_PATH|HOSTALIASES|LOCALDOMAIN|RES_OPTIONS|TMPDIR|EDITOR|VISUAL|PAGER)$/i;
const read = () => { try { const o = JSON.parse(fs.readFileSync(VF, 'utf8')); return Array.isArray(o.items) ? o.items : []; } catch { return []; } };
function write(items) {
  fs.mkdirSync(path.dirname(VF), { recursive: true });
  const tmp = VF + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2), { mode: 0o600 }); fs.renameSync(tmp, VF);
}
const scopeOf = s => (!s || s === 'global') ? 'global' : okCwd(s);
const vaultList = () => read().map(i => ({ id: i.id, name: i.name, note: i.note || '', scope: i.scope, len: String(i.value).length, updated: i.updated }));
function vaultSet({ id, name, value, note, scope }) {
  if (!NAME.test(name || '')) throw new Error('name must look like an env var, e.g. BITBUCKET_TOKEN');
  if (BLOCK.test(name)) throw new Error('reserved name (it would change how programs start); pick another, e.g. MY_' + name);
  const sc = scopeOf(scope), items = read(); let it = id && items.find(x => x.id === id);
  if (!it) { if (typeof value !== 'string' || !value) throw new Error('value required'); if (items.some(x => x.name === name && x.scope === sc)) throw new Error('already exists in this scope; edit it instead'); it = { id: crypto.randomBytes(6).toString('hex') }; items.push(it); }
  Object.assign(it, { name, scope: sc, note: String(note || '').slice(0, 200), updated: Date.now() }); if (typeof value === 'string' && value) it.value = value;
  write(items); return { id: it.id };
}
function vaultGet(id) { const it = read().find(x => x.id === id); if (!it) throw new Error('not found'); return { name: it.name, value: it.value }; }
function vaultDel(id) { const items = read(), n = items.filter(x => x.id !== id); if (n.length === items.length) throw new Error('not found'); write(n); }
function vaultResolve(name, project) { // project value overrides global
  const it = read(); return (project && it.find(x => x.name === name && x.scope === path.resolve(project)) || it.find(x => x.name === name && x.scope === 'global') || {}).value; }
function vaultEnv(...dirs) { // env for a session: global secrets, then secrets of any given project dir (override)
  const items = read(), env = {}, ds = dirs.filter(Boolean).map(d => path.resolve(d));
  const ok = i => NAME.test(i.name) && !BLOCK.test(i.name) && !(i.name in process.env); // never override what the hub itself runs with
  for (const i of items) if (i.scope === 'global' && ok(i)) env[i.name] = i.value;
  for (const i of items) if (ds.includes(i.scope) && ok(i)) env[i.name] = i.value;
  return env;
}
module.exports = { vaultEnv, vaultList, vaultSet, vaultGet, vaultDel, vaultResolve, VF };
