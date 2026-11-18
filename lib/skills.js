'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync, spawnSync, execFile } = require('child_process');
const { HOME, PROJ, body, git, json, okCwd, pexec } = require('./core');
const { allSessions, cache, findFile, parseSession, rulesFor } = require('./sessions');

const CFG = path.join(HOME, '.claude', 'hub-config.json'), LIB = path.join(HOME, '.claude', 'hub-skills'), CACHE = path.join(HOME, '.claude', 'hub-cache');
const readCfg = () => { try { return { defaults: [], installed: {}, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) }; } catch { return { defaults: [], installed: {} }; } };
const writeCfg = c => fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
const fm = f => { let t = ''; try { t = fs.readFileSync(f, 'utf8').slice(0, 6000); } catch { return {}; }
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/), g = k => { const x = m && m[1].match(new RegExp('^' + k + ':\\s*(.*)$', 'm')); return x ? x[1].replace(/^["'>|-]+|["']+$/g, '').trim() : ''; };
  return { name: g('name'), desc: g('description') || (t.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('#')) || '').trim(), body: t }; };
function walkSkills(root, src, depth, out) {
  if (depth < 0) return; let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  if (ents.some(e => e.name === 'SKILL.md')) { const m = fm(path.join(root, 'SKILL.md')); out.push({ name: m.name || path.basename(root), desc: (m.desc || '').slice(0, 300), src, dir: root }); return; }
  for (const e of ents) if ((e.isDirectory() || e.isSymbolicLink()) && !['node_modules', '.git'].includes(e.name)) walkSkills(path.join(root, e.name), src, depth - 1, out);
}
let skCache = { t: 0, v: [] };
function scanSkills() {
  if (Date.now() - skCache.t < 20000) return skCache.v;
  const out = [];
  walkSkills(path.join(HOME, '.claude', 'skills'), 'global', 2, out);
  walkSkills(LIB, 'library', 2, out);
  const pl = path.join(HOME, '.claude', 'plugins');
  try { for (const d of fs.readdirSync(pl)) { if (['cache', 'marketplaces', 'data', 'repos'].includes(d)) walkSkills(path.join(pl, d), 'plugin', 7, out); } } catch {}
  const seen = new Set(), res = [];
  for (const k of out) { const key = k.src + ':' + k.name; if (!seen.has(key)) { seen.add(key); res.push(k); } }
  skCache = { t: Date.now(), v: res }; return res;
}
const usageCache = new Map();
function fileUsage(p) {
  let st; try { st = fs.statSync(p); } catch { return {}; }
  let h = usageCache.get(p);
  if (!h || h.m !== st.mtimeMs) { const c = {}; for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l.includes('"name":"Skill"')) continue; let o; try { o = JSON.parse(l); } catch { continue; } const ct = o.message && o.message.content; if (Array.isArray(ct)) for (const b of ct) if (b.type === 'tool_use' && b.name === 'Skill' && b.input && b.input.skill) c[b.input.skill] = (c[b.input.skill] || 0) + 1; } h = { m: st.mtimeMs, c }; usageCache.set(p, h); }
  return h.c;
}
function skillUsage(filter) {
  const tot = {};
  for (const d of fs.readdirSync(PROJ)) { let fl; try { fl = fs.readdirSync(path.join(PROJ, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of fl) { if (filter && !filter(f.slice(0, -6))) continue; for (const [k, v] of Object.entries(fileUsage(path.join(PROJ, d, f)))) tot[k] = (tot[k] || 0) + v; } }
  return tot;
}
function projectSkills(cwd) {
  const d = path.join(okCwd(cwd), '.claude', 'skills'); let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch {}
  return ents.map(e => ({ name: e.name, link: e.isSymbolicLink(), dir: path.join(d, e.name) }));
}
const STOP = new Set('this that with from have will your what when then they them were been about into just like make also need want please should would could there their which where while these those some more other than only very can not and the for you are but all any'.split(' '));
const toks = t => [...new Set((String(t).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter(w => !STOP.has(w)))];
function suggest(id, cwd) {
  const f = findFile(id); if (!f) return [];
  const s = parseSession(f), q = new Set(toks([s.title, s.first, s.last, s.lastAssistant, path.basename(s.cwd)].join(' ')));
  const all = scanSkills().filter(k => k.src !== 'global'), df = {}; const docs = all.map(k => { const t = toks(k.name.replace(/[-_]/g, ' ') + ' ' + k.desc); t.forEach(w => df[w] = (df[w] || 0) + 1); return t; });
  const have = new Set(projectSkills(cwd || s.cwd).map(x => x.name));
  return all.map((k, i) => ({ k, sc: docs[i].reduce((a, w) => a + (q.has(w) ? 1 / Math.log(2 + df[w]) : 0), 0), hit: docs[i].filter(w => q.has(w)).slice(0, 4) }))
    .filter(x => x.sc > 0.4 && !have.has(x.k.name)).sort((a, b) => b.sc - a.sc).slice(0, 6).map(x => ({ name: x.k.name, src: x.k.src, desc: x.k.desc, why: x.hit.join(', ') }));
}
const hypeCache = {};
async function ghSearch(q) {
  const params = ['search/repositories', '-X', 'GET', '-f', 'q=' + q, '-f', 'sort=stars', '-f', 'order=desc', '-f', 'per_page=20'];
  let r = await pexec('gh', ['api', ...params], { timeout: 20000 }); let j;
  try { j = JSON.parse(r.out); } catch {}
  if (!j || !j.items) { try { const x = await fetch('https://api.github.com/search/repositories?' + new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: '20' }), { headers: { 'user-agent': 'session-hub', accept: 'application/vnd.github+json' } }); j = await x.json(); } catch (e) { return { error: String(e) }; } }
  if (!j.items) return { error: j.message || 'github search failed (rate limit?)' };
  return j.items.map(i => ({ name: i.full_name, desc: i.description || '', stars: i.stargazers_count, url: i.html_url, lang: i.language || '', pushed: i.pushed_at }));
}
const HCATS = { frontend: ['frontend', 'react', 'vue', 'nextjs', 'css'], backend: ['backend', 'api', 'nodejs', 'fastapi', 'django'], ui: ['ui', 'design', 'ux', 'tailwind', 'figma'], security: ['security', 'vulnerability', 'pentest', 'audit', 'owasp'], quality: ['code-review', 'refactor', 'lint', 'clean-code', 'simplify'], testing: ['testing', 'tdd', 'playwright', 'jest', 'pytest'], devops: ['devops', 'docker', 'kubernetes', 'aws', 'cloudflare'], data: ['database', 'sql', 'postgres', 'analytics', 'data-science'], ai: ['agent', 'llm', 'mcp', 'prompt', 'rag'], mobile: ['mobile', 'ios', 'android', 'flutter', 'react-native'], docs: ['documentation', 'writing', 'markdown', 'docs'], productivity: ['productivity', 'workflow', 'automation', 'planning'], re: ['reverse-engineering', 'decompile', 'ghidra', 'binary-analysis', 'frida'], git: ['git', 'github', 'pull-request', 'commit', 'changelog'] };
async function hype(kind, cat, q) {
  q = String(q || '').replace(/[^\w .-]/g, ' ').trim().slice(0, 60); cat = HCATS[cat] ? cat : '';
  const key = kind + '|' + cat + '|' + q, h = hypeCache[key]; if (h && Date.now() - h.t < 600000) return h.v;
  const kw = (cat ? '(' + HCATS[cat].join(' OR ') + ') ' : '') + (q ? q + ' ' : '') + (cat || q ? 'in:name,description,topics ' : '');
  let v;
  if (kind === 'skills') {
    const qs = (cat || q ? ['topic:claude-skills', 'topic:claude-code'] : ['topic:claude-skills', 'topic:claude-code-skills', 'topic:agent-skills', 'topic:claude-code']).map(t => kw + t);
    const rs = await Promise.all(qs.map(ghSearch)), seen = new Map();
    for (const r of rs) if (Array.isArray(r)) for (const i of r) if (!seen.has(i.name)) seen.set(i.name, i);
    v = seen.size ? [...seen.values()].sort((a, b) => b.stars - a.stars).slice(0, 30) : (rs.some(r => r.error) ? { error: (rs.find(r => r.error) || {}).error } : []);
  } else {
    const d = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    v = await ghSearch(kw + 'created:>' + d + ' stars:>' + (cat || q ? 10 : 50));
  }
  if (Array.isArray(v)) hypeCache[key] = { t: Date.now(), v };
  return v;
}
const REPO = /^[\w.-]+\/[\w.-]+$/;
async function installPreview(repo) {
  if (!REPO.test(repo)) throw new Error('bad repo name');
  const dir = path.join(CACHE, repo.replace('/', '__')); fs.mkdirSync(CACHE, { recursive: true }); fs.rmSync(dir, { recursive: true, force: true });
  const r = await pexec('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--no-recurse-submodules', '--', 'https://github.com/' + repo + '.git', dir], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.e) throw new Error('clone failed: ' + (r.err || r.e.message).slice(0, 200));
  const found = []; walkSkills(dir, 'x', 4, found);
  return found.map(k => {
    const files = []; (function w(d, dep) { if (dep > 3) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) w(p, dep + 1); else files.push(path.relative(k.dir, p)); } })(k.dir, 0);
    return { name: k.name, desc: k.desc, rel: path.relative(dir, k.dir), excerpt: fm(path.join(k.dir, 'SKILL.md')).body.slice(0, 1500), scripts: files.filter(f => /\.(sh|py|js|ts|rb|pl|exe|bin)$/i.test(f)), fileCount: files.length };
  });
}
function installSelected(repo, rels) {
  if (!REPO.test(repo)) throw new Error('bad repo name');
  const root = path.join(CACHE, repo.replace('/', '__')), cfg = readCfg(), done = [];
  fs.mkdirSync(LIB, { recursive: true });
  for (const rel of rels) {
    const src = path.resolve(root, rel); if (!src.startsWith(root + path.sep) || !fs.existsSync(path.join(src, 'SKILL.md'))) continue;
    const name = (fm(path.join(src, 'SKILL.md')).name || path.basename(src)).replace(/[^\w.-]/g, '-').slice(0, 60), dest = path.join(LIB, name);
    if (fs.existsSync(dest)) { done.push({ name, skipped: 'already installed' }); continue; }
    fs.cpSync(src, dest, { recursive: true, filter: p => path.basename(p) !== '.git' });
    cfg.installed[name] = repo; done.push({ name }); }
  writeCfg(cfg); skCache.t = 0; return done;
}
function skillAudit(repo) {
  const ids = new Set(allSessions().sessions.filter(s => s.repo === repo || s.cwd === repo).map(s => s.id));
  const inRepo = skillUsage(id => ids.has(id)), all = skillUsage(), sk = scanSkills(), have = new Set(projectSkills(repo).map(x => x.name));
  const rows = [...new Set([...Object.keys(inRepo), ...have])].map(n => ({ name: n, uses: inRepo[n] || 0, enabledHere: have.has(n), src: (sk.find(k => k.name === n) || {}).src || '?' })).sort((a, b) => b.uses - a.uses);
  return { sessions: ids.size, rows, unusedEnabled: rows.filter(r => r.enabledHere && !r.uses).map(r => r.name), globalNeverUsed: sk.filter(k => k.src === 'global' && !all[k.name]).map(k => k.name) };
}
function rulesAudit(cwd) {
  const R = rulesFor(cwd), seen = {}, dups = [];
  for (const r of R) for (const l of new Set(r.content.split('\n').map(x => x.trim().toLowerCase()).filter(x => x.length > 30))) (seen[l] ||= []).push(r.path);
  for (const [l, ps] of Object.entries(seen)) if (ps.length > 1) dups.push({ line: l.slice(0, 120), in: ps });
  return { files: R.map(r => ({ path: r.path, bytes: Buffer.byteLength(r.content) })), total: R.reduce((a, r) => a + Buffer.byteLength(r.content), 0), dups: dups.slice(0, 15) };
}

const SNAME = /^[a-z0-9][a-z0-9-]{0,48}$/;
function skillNew(scope, name, desc) { // scaffold SKILL.md in ~/.claude/skills (global) or <project>/.claude/skills
  if (!SNAME.test(name || '')) throw new Error('name: lowercase letters, digits, dashes');
  const base = scope === 'global' ? path.join(HOME, '.claude', 'skills') : path.join(okCwd(scope), '.claude', 'skills'), d = path.join(base, name);
  if (fs.existsSync(d)) throw new Error('already exists'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${String(desc || 'Describe when Claude should use this skill').replace(/[\r\n]+/g, ' ').slice(0, 300)}\n---\n\n# ${name}\n\nWrite the instructions here.\n`);
  skCache.t = 0; return { path: path.join(d, 'SKILL.md') };
}
function skillGlobal(name, on) { // link a hub-library/plugin skill into ~/.claude/skills (all projects), or unlink
  const dest = path.join(HOME, '.claude', 'skills', path.basename(name || ''));
  if (!on) { if (!fs.lstatSync(dest).isSymbolicLink()) throw new Error('not a hub-managed link'); fs.unlinkSync(dest); skCache.t = 0; return; }
  const k = scanSkills().find(x => x.name === name && x.src !== 'global'); if (!k) throw new Error('skill not found');
  fs.mkdirSync(path.dirname(dest), { recursive: true }); if (!fs.existsSync(dest)) fs.symlinkSync(k.dir, dest, 'dir'); skCache.t = 0;
}
function resetSkillCache() { skCache.t = 0; }
module.exports = { skillNew, skillGlobal, resetSkillCache, LIB, hype, installPreview, installSelected, projectSkills, readCfg, rulesAudit, scanSkills, skillAudit, skillUsage, suggest, writeCfg };
