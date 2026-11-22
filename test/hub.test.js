const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
process.env.HOME = home; process.env.USERPROFILE = home; // must be set before server.js is loaded (HOME on Linux/macOS, USERPROFILE on Windows)
const work = path.join(home, 'projects', 'demo'); fs.mkdirSync(work, { recursive: true });
const pdir = path.join(home, '.claude', 'projects', '-demo'); fs.mkdirSync(pdir, { recursive: true });
const ID = '11111111-2222-3333-4444-555555555555';
const lines = [
  { type: 'user', cwd: work, timestamp: '2026-01-01T10:00:00Z', message: { role: 'user', content: 'fix the login bug' } },
  { type: 'assistant', timestamp: '2026-01-01T10:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Looking at it.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.js' } }] } },
  { type: 'user', timestamp: '2026-01-01T10:00:06Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'file body', is_error: false }] } },
  { type: 'user', isMeta: true, message: { role: 'user', content: 'meta ignored' } },
  { type: 'assistant', timestamp: '2026-01-01T10:01:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] } },
  { type: 'ai-title', aiTitle: 'Fix login' },
];
fs.writeFileSync(path.join(pdir, ID + '.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
const hub = require('../server.js');

test('okCwd accepts folders under home and rejects everything else', () => {
  assert.strictEqual(hub.okCwd(work), work);
  assert.throws(() => hub.okCwd('/etc'));
  assert.throws(() => hub.okCwd(path.join(home, 'missing')));
  assert.throws(() => hub.okCwd(''));
});

test('parseSession reads folder, first and last prompt, title', () => {
  const s = hub.parseSession(path.join(pdir, ID + '.jsonl'));
  assert.strictEqual(s.id, ID); assert.strictEqual(s.cwd, work);
  assert.strictEqual(s.first, 'fix the login bug'); assert.strictEqual(s.title, 'Fix login');
});

test('transcript returns user, assistant, tool call and result, skipping meta', () => {
  const t = hub.transcript(ID, 0, 50);
  assert.deepStrictEqual(t.msgs.map(m => m.r), ['u', 'a', 't', 'o', 'a']);
  assert.ok(!t.msgs.some(m => /meta ignored/.test(m.t)));
  assert.strictEqual(hub.transcript('nope', 0, 5).error, 'session not found');
});

test('transcript paginates from the end', () => {
  const t = hub.transcript(ID, 0, 2); assert.strictEqual(t.msgs.length, 2); assert.strictEqual(t.start, 3);
  const e = hub.transcript(ID, t.start, 2); assert.strictEqual(e.msgs.length, 2);
});

function req(port, method, p, headers = {}, body) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d, headers: x.headers })); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

test('HTTP guards: sign-in, header, host and input validation', async () => {
  await new Promise(r => hub.server.listen(0, '127.0.0.1', r));
  const port = hub.server.address().port, tok = fs.readFileSync(path.join(home, '.claude', 'hub-token'), 'utf8').trim();
  const C = { cookie: 'hub_tok=' + tok }, H = { ...C, 'x-hub': '1', 'content-type': 'application/json' };
  try {
    assert.strictEqual(tok.length, 64);
    if (process.platform !== 'win32') assert.strictEqual((fs.statSync(path.join(home, '.claude', 'hub-token')).mode & 0o777), 0o600, 'token file is private');
    assert.strictEqual((await req(port, 'GET', '/api/sessions', { 'x-hub': '1' })).status, 401, 'no cookie');
    assert.strictEqual((await req(port, 'GET', '/')).status, 401, 'page needs sign-in');
    assert.strictEqual((await req(port, 'GET', '/?k=wrong')).status, 403, 'wrong key');
    const login = await req(port, 'GET', '/?k=' + tok); assert.strictEqual(login.status, 302);
    assert.match(login.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
    const page = await req(port, 'GET', '/', C); assert.strictEqual(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.strictEqual((await req(port, 'GET', '/api/sessions', C)).status, 403, 'cookie but no x-hub header');
    assert.strictEqual((await req(port, 'GET', '/api/sessions', H)).status, 200);
    assert.strictEqual((await req(port, 'GET', '/api/sessions', { ...H, host: 'evil.example' })).status, 403, 'bad Host');
    assert.strictEqual((await req(port, 'POST', '/api/tag', { 'content-type': 'application/json', 'x-hub': '1' }, '{}')).status, 401, 'POST without cookie');
    assert.strictEqual((await req(port, 'POST', '/api/send-stream', H, '{}')).status, 404, 'headless send was removed');
    assert.match((await req(port, 'POST', '/api/session-destroy', H, JSON.stringify({ id: ID, confirm: 'delete' }))).body, /type DELETE/);
    assert.ok(fs.existsSync(path.join(pdir, ID + '.jsonl')), 'wrong confirmation deletes nothing');
  } finally { hub.server.close(); }
});

test('vault: values never listed, file is 0600, project overrides global', () => {
  const v = require('../lib/vault'), fs = require('fs');
  v.vaultSet({ name: 'BB_TOKEN', value: 'GVAL9', scope: 'global' });
  const id = v.vaultSet({ name: 'BB_TOKEN', value: 'PVAL9', scope: work }).id;
  assert.ok(!JSON.stringify(v.vaultList()).includes('PVAL9'));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(v.VF).mode & 0o777, 0o600);
  assert.strictEqual(v.vaultResolve('BB_TOKEN', work), 'PVAL9');
  assert.strictEqual(v.vaultResolve('BB_TOKEN', home), 'GVAL9');
  assert.throws(() => v.vaultSet({ name: 'bad name', value: 'x' }));
  assert.throws(() => v.vaultSet({ name: 'BB_TOKEN', value: 'x', scope: work }));
  v.vaultDel(id); assert.strictEqual(v.vaultList().length, 1);
});

test('skillNew scaffolds locally and rejects bad names', () => {
  const sk = require('../lib/skills');
  const r = sk.skillNew(work, 'my-skill', 'does x'); assert.ok(fs.readFileSync(r.path, 'utf8').includes('name: my-skill'));
  assert.throws(() => sk.skillNew(work, 'my-skill')); assert.throws(() => sk.skillNew(work, '../x'));
  assert.ok(sk.skillNew('global', 'g-skill').path.startsWith(home));
});

test('vaultEnv: global then project override', () => {
  const v = require('../lib/vault');
  v.vaultSet({ name: 'E_ONE', value: 'g1', scope: 'global' }); v.vaultSet({ name: 'E_ONE', value: 'p1', scope: work }); v.vaultSet({ name: 'E_TWO', value: 'g2', scope: 'global' });
  assert.deepStrictEqual(v.vaultEnv(work), { ...v.vaultEnv(), E_ONE: 'p1' }); assert.strictEqual(v.vaultEnv(work).E_TWO, 'g2'); assert.strictEqual(v.vaultEnv(home).E_ONE, 'g1');
});

test('vault rejects names that could hijack a process', () => {
  const v = require('../lib/vault');
  for (const n of ['LD_PRELOAD', 'PATH', 'NODE_OPTIONS', 'GIT_SSH_COMMAND', 'path', 'BASH_ENV']) assert.throws(() => v.vaultSet({ name: n, value: 'x' }), /reserved/);
  fs.writeFileSync(v.VF, JSON.stringify({ items: [{ id: 'x', name: 'LD_PRELOAD', value: '/evil.so', scope: 'global' }] }));
  assert.strictEqual(v.vaultEnv(work).LD_PRELOAD, undefined);
});

test('agent registry: claude adapter lists sessions tagged with agent and builds commands', () => {
  const reg = require('../lib/agents'), cl = reg.get('claude');
  assert.deepStrictEqual(cl.resumeCmd({ id: ID }), ['claude', '--resume', ID]);
  assert.deepStrictEqual(cl.newCmd(work, ID), ['claude', '--session-id', ID]);
  assert.ok(reg.agents().some(a => a.id === 'claude' && a.capabilities.resume));
  const l = cl.list(); assert.ok(l.sessions.length && l.sessions.every(s => s.agent === 'claude'));
  assert.strictEqual(reg.sessions('nope').sessions.length, 0);
});

test('antigravity adapter: lists conversations from brain notes, read-only', () => {
  const ag = require('../lib/agents/antigravity'), id = 'aaaaaaaa-1111-2222-3333-444444444444';
  const root = path.join(home, '.gemini', 'antigravity'); fs.mkdirSync(path.join(root, 'conversations'), { recursive: true }); fs.mkdirSync(path.join(root, 'brain', id), { recursive: true });
  fs.writeFileSync(path.join(root, 'conversations', id + '.pb'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(root, 'brain', id, 'implementation_plan.md'), '# Speed up the report\n\nsee ' + work + '/a.js\n');
  fs.writeFileSync(path.join(root, 'brain', id, 'implementation_plan.md.metadata.json'), JSON.stringify({ summary: 'Add an index' }));
  const s = ag.list().sessions.find(x => x.id === id);
  assert.strictEqual(s.agent, 'antigravity'); assert.strictEqual(s.title, 'Speed up the report'); assert.strictEqual(s.cwd, work); assert.strictEqual(s.first, 'Add an index');
  assert.ok(ag.installed()); assert.ok(!ag.capabilities.chat && !ag.capabilities.resume && ag.capabilities.openFolder);
});

test('codex adapter (experimental): lists, reads transcript, skips sub-agents and context noise, builds resume command', () => {
  const cx = require('../lib/agents/codex'), id = 'bbbbbbbb-1111-2222-3333-444444444444', sub = 'cccccccc-9999-2222-3333-444444444444', v7 = '01997ddc-88f4-7e40-8dac-d558f31dd3ca', d = path.join(home, '.codex', 'sessions', '2026', '11', '22'); fs.mkdirSync(d, { recursive: true });
  const msg = (role, type, text, t) => ({ timestamp: t, type: 'response_item', payload: { type: 'message', role, content: [{ type, text }] } });
  const L = [{ timestamp: '2026-11-22T10:00:00Z', type: 'session_meta', payload: { id, cwd: work, source: 'cli', originator: 'codex_cli_rs' } },
    msg('user', 'input_text', '<environment_context>x</environment_context>', '2026-11-22T10:00:01Z'), msg('user', 'input_text', '# AGENTS.md instructions for /x\nbe nice', '2026-11-22T10:00:01Z'),
    msg('developer', 'input_text', 'internal rules', '2026-11-22T10:00:01Z'), msg('user', 'input_text', 'rename the helper', '2026-11-22T10:00:02Z'),
    { timestamp: '2026-11-22T10:00:02Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch', call_id: 'c1' } },
    { timestamp: '2026-11-22T10:00:03Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'patched' } },
    { timestamp: '2026-11-22T10:00:03Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: [{ type: 'input_text', text: 'listed 3 files' }] } },
    { timestamp: '2026-11-22T10:00:03Z', type: 'response_item', payload: { type: 'reasoning', summary: [] } }, { timestamp: '2026-11-22T10:00:03Z', type: 'compacted', payload: {} },
    msg('assistant', 'output_text', 'Done.', '2026-11-22T10:00:04Z')];
  fs.writeFileSync(path.join(d, 'rollout-2026-11-22T10-00-00-' + id + '.jsonl'), L.map(x => JSON.stringify(x)).join('\n') + '\n{"half written');
  fs.writeFileSync(path.join(d, 'rollout-2026-11-22T10-01-00-' + sub + '.jsonl'), JSON.stringify({ timestamp: '2026-11-22T10:01:00Z', type: 'session_meta', payload: { id: sub, cwd: work, source: { subagent: 'review' } } }) + '\n');
  fs.writeFileSync(path.join(d, 'rollout-2026-11-22T10-02-00-' + v7 + '.jsonl'), [{ timestamp: '2026-11-22T10:02:00Z', type: 'session_meta', payload: { id: v7, cwd: work } }, { timestamp: '2026-11-22T10:02:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'only an event message' } }].map(x => JSON.stringify(x)).join('\n') + '\n');
  const all = cx.list().sessions, s = all.find(x => x.id === id);
  assert.strictEqual(s.agent, 'codex'); assert.strictEqual(s.cwd, work); assert.strictEqual(s.first, 'rename the helper'); assert.strictEqual(s.lastAssistant, 'Done.');
  assert.ok(!all.some(x => x.id === sub), 'sub-agent threads are hidden'); assert.strictEqual(all.find(x => x.id === v7).first, 'only an event message', 'uuid v7 ids and event_msg fallback work');
  const t = cx.transcript(id, 0, 50); assert.deepStrictEqual(t.msgs.map(m => m.r), ['u', 't', 'o', 'o', 'a']); assert.ok(t.msgs[3].t.includes('listed 3 files'));
  assert.deepStrictEqual(cx.resumeCmd({ id }), ['codex', 'resume', id]); assert.ok(cx.experimental); assert.ok(cx.installed());
  const g = cx.diagnose(), txt = JSON.stringify(g); assert.ok(g.lineTypes['response_item:custom_tool_call'] && g.unparsableLines === 1 && g.sessionMetaKeys.includes('cwd'));
  assert.ok(!txt.includes('rename the helper') && !txt.includes(work) && !txt.includes(id), 'diagnose never includes text, paths or ids');
});

test('optimize: token counts per transcript, duplicate message ids counted once', () => {
  const { fileTokens } = require('../lib/optimize'), f = path.join(pdir, 'cccccccc-1111-2222-3333-444444444444.jsonl');
  const a = { type: 'assistant', requestId: 'r1', message: { id: 'm1', role: 'assistant', content: [], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } };
  fs.writeFileSync(f, [a, a, { ...a, requestId: 'r2', message: { ...a.message, id: 'm2' } }].map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.deepStrictEqual(fileTokens(f), { in: 20, out: 10, cr: 200, cc: 40, turns: 2, m: { other: { in: 20, out: 10, cr: 200, cc: 40 } } });
});

test('UI assets are served only from /web with a safe name, and the page has no inline script', async () => {
  const port = await new Promise(r => hub.server.listen(0, '127.0.0.1', () => r(hub.server.address().port)));
  try {
    const login = await req(port, 'GET', '/?k=' + require('../lib/core').TOKEN, { host: '127.0.0.1:' + port });
    const ck = (login.headers['set-cookie'] || [''])[0].split(';')[0], H = { host: '127.0.0.1:' + port, cookie: ck, 'x-hub': '1' };
    assert.strictEqual((await req(port, 'GET', '/web/app.js', H)).status, 200);
    assert.strictEqual((await req(port, 'GET', '/web/styles.css', H)).status, 200);
    assert.strictEqual((await req(port, 'GET', '/web/..%2fserver.js', H)).status, 404);
    assert.strictEqual((await req(port, 'GET', '/web/nope.js', H)).status, 404);
    assert.strictEqual((await req(port, 'GET', '/web/app.js', { host: '127.0.0.1:' + port })).status, 401, 'needs sign-in');
    const page = await req(port, 'GET', '/', H); assert.ok(!/<script>[^<]/.test(page.body) && !page.headers['content-security-policy'].includes("script-src 'self' 'unsafe-inline'"));
  } finally { hub.server.close(); }
});

test('watch: finds secret kinds without keeping values, ignores placeholders, reads context size', () => {
  const w = require('../lib/watch'), tok = 'github_pat_' + 'B'.repeat(40);
  const r = w.secretsIn('pasted ' + tok + ' and postgres://app:Zq8vK2mPlt@db.internal/x and postgres://user:password@localhost/x and AKIA' + 'A'.repeat(16));
  assert.deepStrictEqual(r, { 'GitHub token': 1, 'AWS access key': 1, 'Database URL with password': 1 });
  assert.ok(!JSON.stringify(r).includes('BBBB'));
  const line = JSON.stringify({ message: { model: 'claude-opus-x', usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 3 } } });
  const t = w.scanText('{"isCompactSummary":true}\n' + line + '\n'); assert.strictEqual(t.ctx, 108); assert.strictEqual(t.compacts, 1);
});

test('notes: per-project decisions are stored privately and reach the claude new-session command', () => {
  const n = require('../lib/notes'), cl = require('../lib/agents/claude');
  assert.deepStrictEqual(cl.newCmd(work, ID), ['claude', '--session-id', ID]);
  n.setNote(work, 'use the repo helper, not raw SQL');
  const c = cl.newCmd(work, ID); assert.strictEqual(c[3], '--append-system-prompt'); assert.ok(c[4].includes('repo helper'));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(home, '.claude', 'hub-notes.json')).mode & 0o777, 0o600);
  n.setNote(work, ''); assert.strictEqual(n.getNote(work), '');
});

test('perms: exact read-only commands pass a strict token allowlist; everything else is rejected', () => {
  const p = require('../lib/perms');
  for (const c of ['git status -s', 'git  diff   --stat', 'ls', 'ls -la src', 'git log --oneline -5', 'git diff HEAD~1', 'grep -rn foo src', 'git diff --stat=80']) assert.strictEqual(p.match(c), c.trim().replace(/\s+/g, ' '), c);
  for (const c of ['git diff --output=/tmp/x', 'git diff --out=/tmp/x', 'git diff --ext', 'git diff --ext-diff', 'git log -c', 'git -c core.pager=x log', 'git branch -D x', 'find . -exec rm {} +', 'rg --pre ./x foo', 'make deploy', 'npm test', 'pytest', 'node --test',
    'go test ./...', 'rm -rf x', 'curl http://x', 'lsof -i', 'git statusx', 'ls *.js', 'git diff HEAD:file', 'git diff {a,b}', 'grep "a b" src', 'git diff -o x', 'git show --textconv x']) assert.strictEqual(p.match(c), null, c);
});

test('cost: uses only prices the user entered', () => {
  const o = require('../lib/optimize');
  assert.strictEqual(o.costOf({ opus: { in: 1e6, out: 1e6, cr: 0, cc: 0 } }, {}), 0);
  assert.strictEqual(o.costOf({ opus: { in: 1e6, out: 2e6, cr: 0, cc: 0 } }, { opus: { in: 3, out: 10, cr: 0, cc: 0 } }), 23);
});

test('wtNew: creates a worktree from the fetched base and rejects bad names', () => {
  const { execFileSync: x } = require('child_process'), wt = require('../lib/worktrees'), o = path.join(home, 'origin.git'), r = path.join(home, 'projects', 'wtrepo');
  x('git', ['init', '-q', '--bare', '-b', 'dev', o]); x('git', ['init', '-q', '-b', 'dev', r]);
  x('git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']); x('git', ['-C', r, 'remote', 'add', 'origin', o]); x('git', ['-C', r, 'push', '-q', 'origin', 'dev']);
  const d = wt.wtNew(r, 'BJS-1-task-demo', 'dev'); assert.ok(fs.existsSync(path.join(d.dir, '.git'))); assert.ok(d.dir.endsWith('wtrepo-BJS-1-task-demo'));
  assert.throws(() => wt.wtNew(r, 'bad name', 'dev')); assert.throws(() => wt.wtNew(r, 'x;rm', 'dev')); assert.throws(() => wt.wtNew(r, 'BJS-1-task-demo', 'dev'), /exists/);
  assert.strictEqual(wt.defaultBase(r), 'dev');
});

test('destroySession: removes transcript and leftovers for that id only, and clears tags', () => {
  const S = require('../lib/sessions'), id = 'dddddddd-1111-2222-3333-444444444444', other = 'eeeeeeee-1111-2222-3333-444444444444';
  const f = path.join(pdir, id + '.jsonl'), o = path.join(pdir, other + '.jsonl'), sub = path.join(pdir, id), fh = path.join(home, '.claude', 'file-history', id);
  fs.writeFileSync(f, '{"type":"user","cwd":"' + work + '","message":{"role":"user","content":"x"}}\n'); fs.writeFileSync(o, fs.readFileSync(f)); fs.mkdirSync(sub, { recursive: true }); fs.writeFileSync(path.join(sub, 'a.txt'), 'x'); fs.mkdirSync(fh, { recursive: true });
  const tf = path.join(home, '.claude', 'session-tags.json'); fs.writeFileSync(tf, JSON.stringify({ [id]: { note: 'n' }, [other]: { note: 'keep' } }));
  const r = S.destroySession(id); assert.strictEqual(r.killed, 0);
  assert.ok(!fs.existsSync(f) && !fs.existsSync(sub) && !fs.existsSync(fh)); assert.ok(fs.existsSync(o), 'other session untouched');
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(tf, 'utf8'))), [other]);
  assert.throws(() => S.destroySession(id), /not found/); assert.throws(() => S.destroySession('../../etc'), /bad session id/);
});

test('closed is a normal status: it can be set and reopened through the tag API, unlike close-for-good', async () => {
  const port = await new Promise(r => hub.server.listen(0, '127.0.0.1', () => r(hub.server.address().port))), tok = fs.readFileSync(path.join(home, '.claude', 'hub-token'), 'utf8').trim();
  const H = { host: '127.0.0.1:' + port, cookie: 'hub_tok=' + tok, 'x-hub': '1', 'content-type': 'application/json' };
  try {
    await req(port, 'POST', '/api/tag', H, JSON.stringify({ id: ID, status: 'closed' }));
    assert.strictEqual(JSON.parse((await req(port, 'GET', '/api/sessions', H)).body).sessions.find(s => s.id === ID).status, 'closed');
    await req(port, 'POST', '/api/tag', H, JSON.stringify({ id: ID, status: 'active' }));
    assert.strictEqual(JSON.parse((await req(port, 'GET', '/api/sessions', H)).body).sessions.find(s => s.id === ID).status, 'active');
    assert.ok(fs.existsSync(path.join(pdir, ID + '.jsonl')), 'closing never deletes the chat');
  } finally { hub.server.close(); }
});

test('snippets: saved per scope, validated, never contain more than the limits', () => {
  const sn = require('../lib/snippets'); const a = sn.set({ scope: 'global', name: 'Review diff', text: 'Review my diff for bugs.' }); sn.set({ scope: work, name: 'Run tests', text: 'Run the tests and fix failures.' });
  const l = sn.list(work); assert.strictEqual(l.global.length, 1); assert.strictEqual(l.project.length, 1);
  assert.throws(() => sn.set({ scope: 'global', name: '', text: 'x' })); assert.throws(() => sn.set({ scope: '/etc', name: 'x', text: 'y' }));
  sn.del({ scope: 'global', id: a.id }); assert.strictEqual(sn.list(work).global.length, 0);
});

test('backup: export has no secrets or chats, import only adds what is missing', () => {
  const b = require('../lib/backup'), v = require('../lib/vault'); try { v.vaultSet({ name: 'BK_SECRET', value: 'topsecretvalue9', scope: 'global' }); } catch {}
  const e = b.exportAll(); assert.ok(!JSON.stringify(e).includes('topsecretvalue9') && e.marram === 1);
  const tf = path.join(home, '.claude', 'session-tags.json'); fs.writeFileSync(tf, JSON.stringify({ 'aaaaaaaa-0000-1111-2222-333333333333': { status: 'later' } }));
  const r = b.importAll({ marram: 1, tags: { 'aaaaaaaa-0000-1111-2222-333333333333': { status: 'done' }, 'bbbbbbbb-0000-1111-2222-333333333333': { status: 'closed', pin: true, kind: 'bug' }, '../x': { status: 'done' } } });
  const t = JSON.parse(fs.readFileSync(tf, 'utf8')); assert.strictEqual(t['aaaaaaaa-0000-1111-2222-333333333333'].status, 'later'); assert.deepStrictEqual(t['bbbbbbbb-0000-1111-2222-333333333333'], { status: 'closed', kind: 'bug', pin: true }); assert.ok(!t['../x']); assert.strictEqual(r.added, 1);
  assert.throws(() => b.importAll({ nope: 1 }), /not a Marram export/);
});

test('activity log keeps the last entries without chat text; github remotes are parsed', () => {
  const a = require('../lib/activity'); for (let i = 0; i < 3; i++) a.log('closed for good', 'title ' + i);
  assert.strictEqual(a.recent(2)[0].detail, 'title 2'); const pr = require('../lib/prstatus');
  assert.deepStrictEqual(pr.parse('git@github.com:acme/shop.git'), { owner: 'acme', repo: 'shop' }); assert.deepStrictEqual(pr.parse('https://github.com/acme/shop'), { owner: 'acme', repo: 'shop' }); assert.strictEqual(pr.parse('https://bitbucket.org/a/b'), null);
});

test('read-only mode blocks every change except turning it off; bulk tag validates ids and status', async () => {
  const port = await new Promise(r => hub.server.listen(0, '127.0.0.1', () => r(hub.server.address().port))), tok = fs.readFileSync(path.join(home, '.claude', 'hub-token'), 'utf8').trim();
  const H = { host: '127.0.0.1:' + port, cookie: 'hub_tok=' + tok, 'x-hub': '1', 'content-type': 'application/json' }, post = (p, o) => req(port, 'POST', p, H, JSON.stringify(o));
  try {
    await post('/api/tag-many', { ids: [ID, '../x'], status: 'later' }); assert.strictEqual(JSON.parse((await req(port, 'GET', '/api/sessions', H)).body).sessions.find(s => s.id === ID).status, 'later');
    await post('/api/tag-many', { ids: [ID], status: 'bogus' }); assert.strictEqual(JSON.parse((await req(port, 'GET', '/api/sessions', H)).body).sessions.find(s => s.id === ID).status, 'later');
    await post('/api/readonly', { on: true }); const blocked = await post('/api/tag', { id: ID, status: 'done' }); assert.match(blocked.body, /Read-only mode is on/);
    assert.match((await post('/api/vault-get', { id: 'x' })).body, /Read-only/); assert.match((await post('/api/term-start', { cwd: work })).body, /Read-only/);
    assert.strictEqual(JSON.parse((await req(port, 'GET', '/api/mode', H)).body).readOnly, true); await post('/api/readonly', { on: false });
    assert.ok(!/Read-only/.test((await post('/api/tag', { id: ID, status: 'active' })).body));
  } finally { hub.server.close(); }
});

test('auto-stop does nothing below 15 minutes', () => { assert.strictEqual(require('../lib/system').autoStopIdle(5), 0); assert.strictEqual(require('../lib/system').autoStopIdle(0), 0); });

test('security: saved text cannot carry terminal escapes; imports validate folders, clean text and can be previewed first', () => {
  const sn = require('../lib/snippets'), b = require('../lib/backup'), n = require('../lib/notes'), esc = String.fromCharCode(27);
  sn.set({ scope: 'global', name: 'Evil' + esc + '[2J', text: 'hello' + esc + '[201~ rm -rf ~\r\nnext\tline' }); const got = sn.list('').global.find(x => x.name.startsWith('Evil'));
  assert.ok(got && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(got.name + got.text.replace(/[\n\t]/g, '')) && got.text.includes('\n') && got.text.includes('\t') && !got.text.includes(esc));
  n.setNote(work, 'keep' + esc + '[0m this'); assert.strictEqual(n.getNote(work), 'keep[0m this'); n.setNote(work, '');
  const file = { marram: 1, notes: { [work]: 'use the helper' + esc, '/etc': 'sneaky', [path.join(home, 'missing')]: 'x' }, snippets: { global: [{ name: 'Ok', text: 'fine' }], '/etc': [{ name: 'Bad', text: 'no' }] } };
  const dry = b.importAll(file, true); assert.deepStrictEqual(dry.preview.notes.map(x => x.path), [work]); assert.strictEqual(dry.preview.notes[0].text, 'use the helper'); assert.deepStrictEqual(dry.preview.snippets.map(x => x.name), ['Ok']);
  assert.strictEqual(n.getNote(work), '', 'a dry run writes nothing'); b.importAll(file); assert.strictEqual(n.getNote(work), 'use the helper'); n.setNote(work, '');
});

test('messaging: Slack channel/person search, same-name flag, clear errors, webhooks, no secrets in status, no private addresses', async () => {
  const integ = require('../lib/integrations'), seen = [];
  const srv = http.createServer((rq, rs) => { let b = ''; rq.on('data', d => b += d); rq.on('end', () => {
    const q = new URLSearchParams(rq.url.startsWith('/hook') ? '' : b), j = o => { rs.writeHead(200, { 'content-type': 'application/json' }); rs.end(JSON.stringify(o)); }; seen.push({ url: rq.url, auth: rq.headers.authorization, body: rq.url.startsWith('/hook') ? b : Object.fromEntries(q) });
    if (rq.url === '/auth.test') return j({ ok: true, team: 'Acme', user: 'marram' });
    if (rq.url === '/users.list') return j({ ok: true, members: [{ id: 'U0000001', name: 'alex.k', real_name: 'Alex Kim', profile: { email: 'alex.kim@acme.test', title: 'Backend' } }, { id: 'U0000002', name: 'alex.k2', real_name: 'Alex Kim', profile: { email: 'alex.kim@other.test', title: 'Design' } }, { id: 'U0000003', name: 'sam', real_name: 'Sam Lee', profile: { email: 'sam@acme.test' } }, { id: 'U0000004', name: 'bot', real_name: 'Alex Bot', is_bot: true, profile: {} }, { id: 'U0000005', name: 'gone', real_name: 'Alex Gone', deleted: true, profile: {} }], response_metadata: { next_cursor: '' } });
    if (rq.url === '/conversations.list') return j({ ok: true, channels: [{ id: 'C0000001', name: 'team-updates', num_members: 9 }, { id: 'C0000002', name: 'secret', is_private: true }], response_metadata: { next_cursor: '' } });
    if (rq.url === '/chat.postMessage') return q.get('channel') === 'C0000009' ? j({ ok: false, error: 'not_in_channel' }) : j({ ok: true, channel: q.get('channel'), ts: '1.2' });
    if (rq.url === '/chat.getPermalink') return j({ ok: true, permalink: 'https://acme.example/p/1' });
    if (rq.url === '/hook/ok') { rs.writeHead(200); return rs.end('ok'); } rs.writeHead(404); rs.end('gone');
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  process.env.MARRAM_SLACK_API = base; process.env.MARRAM_ALLOW_LOCAL_HOOKS = '1';
  try {
    assert.throws(() => integ.setSlackToken('hello'), /xoxb/); integ.setSlackToken('xoxb-123456789012-abcdefabcdef');
    assert.deepStrictEqual(await integ.slackTest(), { workspace: 'Acme', as: 'marram', url: undefined });
    const people = await integ.findPeople('alex'); assert.deepStrictEqual(people.map(p => p.id), ['U0000001', 'U0000002']); assert.ok(people.every(p => p.sameName) && people[0].email !== people[1].email);
    assert.strictEqual((await integ.findPeople('sam')).length, 1); assert.strictEqual((await integ.findPeople('sam'))[0].sameName, false);
    assert.deepStrictEqual((await integ.findChannels('#team')).map(c => c.name), ['team-updates']);
    const ok = await integ.sendSlack({ id: 'C0000001' }, 'Daily update\nline two'); assert.ok(ok.ok && ok.link.includes('acme.example'));
    assert.strictEqual(seen.find(s => s.url === '/chat.postMessage').auth, 'Bearer xoxb-123456789012-abcdefabcdef');
    await assert.rejects(integ.sendSlack({ id: 'C0000009' }, 'hi'), /not in that channel/); await assert.rejects(integ.sendSlack({ id: 'nope' }, 'hi'), /pick a channel or a person/); await assert.rejects(integ.sendSlack({ id: 'C0000001' }, '   '), /no message text/);
    const h = integ.addHook({ kind: 'teams', label: 'Team standup', url: base + '/hook/ok' }), bad = integ.addHook({ kind: 'slack', label: 'Gone', url: base + '/hook/gone' });
    const r = await integ.sendHook(h.id, 'hello team'); assert.ok(r.ok && r.label === 'Team standup'); const tb = JSON.parse(seen.filter(s => s.url === '/hook/ok').pop().body); assert.strictEqual(tb.attachments[0].content.body[0].text, 'hello team');
    await assert.rejects(integ.sendHook(bad.id, 'x'), /HTTP 404.*Nothing was sent/); await assert.rejects(integ.sendHook(bad.id, 'x'), e => !/gone/.test(e.message.replace(/probably deleted/, '')), 'response bodies are not echoed'); assert.throws(() => integ.addHook({ kind: 'slack', label: 'Gone', url: base + '/x' }), /already exists/);
    const st = JSON.stringify(integ.status()); assert.ok(!st.includes('xoxb') && !st.includes('/hook/ok') && st.includes('Team standup'));
    process.env.MARRAM_ALLOW_LOCAL_HOOKS = '0';
    for (const u of ['http://example.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://192.168.0.5/x', 'https://172.20.0.1/x', 'https://169.254.169.254/x', 'https://[::1]/x', 'https://box.internal/x', 'not a url']) assert.throws(() => integ.addHook({ kind: 'generic', label: 'x' + u.length, url: u }), u);
    assert.ok(integ.addHook({ kind: 'slack', label: 'Real', url: 'https://hooks.slack.com/services/T000/B000/XXXX' }).id);
  } finally { srv.close(); delete process.env.MARRAM_SLACK_API; delete process.env.MARRAM_ALLOW_LOCAL_HOOKS; integ.clearSlack(); }
});

test('messaging route: a send without the confirmation flag is refused and sends nothing', async () => {
  const port = await new Promise(r => hub.server.listen(0, '127.0.0.1', () => r(hub.server.address().port))), tok = fs.readFileSync(path.join(home, '.claude', 'hub-token'), 'utf8').trim();
  const H = { host: '127.0.0.1:' + port, cookie: 'hub_tok=' + tok, 'x-hub': '1', 'content-type': 'application/json' };
  try { assert.match((await req(port, 'POST', '/api/send', H, JSON.stringify({ via: 'hook', hookId: 'x', text: 'hi' }))).body, /confirmation required/); assert.match((await req(port, 'POST', '/api/send', H, JSON.stringify({ via: 'nope', text: 'hi', confirm: true }))).body, /choose where/); } finally { hub.server.close(); }
});

test('custom agents: any command becomes a terminal-only agent, parsed without a shell', () => {
  const c = require('../lib/agents/custom'), reg = require('../lib/agents');
  assert.deepStrictEqual(c.parseCommand('aider --model "gpt 4" -v'), ['aider', '--model', 'gpt 4', '-v']);
  assert.throws(() => c.set({ label: '', command: 'x' }), /name/); assert.throws(() => c.set({ label: 'A', command: '' }), /command/); assert.throws(() => c.set({ label: 'A', command: 'rm;ls' }), /program name/); assert.throws(() => c.set({ label: 'Claude', command: 'x' }), /different name/);
  const r = c.set({ label: 'My Tool', command: 'node --version' }); assert.strictEqual(r.id, 'x-my-tool');
  const a = reg.get('x-my-tool'); assert.deepStrictEqual(a.newCmd(), ['node', '--version']); assert.ok(a.capabilities.newSession && !a.capabilities.resume); assert.ok(reg.agents().find(x => x.id === 'x-my-tool').installed);
  c.del('x-my-tool'); assert.strictEqual(reg.get('x-my-tool'), undefined);
});

test('drafts: Gmail, Outlook, Teams and mail-app links are built from validated addresses and shortened when long', () => {
  const i = require('../lib/integrations');
  const g = i.composeLink({ kind: 'gmail', to: 'a@x.com, b@y.org', subject: 'Update & notes', body: 'Hi\nline two' }); assert.ok(g.url.startsWith('https://mail.google.com/mail/?view=cm') && g.url.includes('to=a%40x.com%2Cb%40y.org') && g.url.includes('su=Update%20%26%20notes') && g.url.includes('%0A') && !g.shortened);
  assert.ok(i.composeLink({ kind: 'outlook', to: 'a@x.com', subject: 's', body: 'b' }).url.startsWith('https://outlook.office.com/mail/deeplink/compose?to=a%40x.com'));
  assert.ok(i.composeLink({ kind: 'outlookcom', to: 'a@x.com', subject: 's', body: 'b' }).url.startsWith('https://outlook.live.com/'));
  assert.ok(i.composeLink({ kind: 'teams', to: 'a@x.com;b@x.com', body: 'hello' }).url.startsWith('https://teams.microsoft.com/l/chat/0/0?users=a%40x.com%2Cb%40x.com&message=hello'));
  assert.ok(i.composeLink({ kind: 'mailto', to: 'a@x.com', subject: 's', body: 'b' }).url.startsWith('mailto:a%40x.com?subject=s'));
  const long = i.composeLink({ kind: 'gmail', to: 'a@x.com', subject: 's', body: 'word '.repeat(2000) }); assert.ok(long.shortened && long.url.length <= 1900);
  for (const bad of ['', 'nope', 'a@b', 'a@b.com, <script>', 'x@y.com\nBcc: z@z.com']) assert.throws(() => i.composeLink({ kind: 'gmail', to: bad, subject: 's', body: 'b' }), bad || 'empty');
  assert.throws(() => i.composeLink({ kind: 'evil', to: 'a@x.com', subject: 's', body: 'b' }), /unknown/);
});

test('webhook safety: private, loopback, CGNAT, link-local and mapped addresses are blocked after DNS lookup; the checked address is the one used', async () => {
  const i = require('../lib/integrations'); delete process.env.MARRAM_ALLOW_LOCAL_HOOKS;
  for (const a of ['127.0.0.1', '10.0.0.1', '172.16.5.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', 'nonsense']) assert.ok(i.isBlockedIp(a), a);
  for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808']) assert.ok(!i.isBlockedIp(a), a);
  await assert.rejects(i.resolveSafe('localhost'), /private network/); await assert.rejects(i.resolveSafe('127.0.0.1'), /private network/); await assert.rejects(i.resolveSafe('[::1]'), /private network/); await assert.rejects(i.resolveSafe('no-such-host.invalid'), /Could not find/);
  assert.strictEqual((await i.resolveSafe('1.1.1.1')).address, '1.1.1.1');
  process.env.MARRAM_ALLOW_LOCAL_HOOKS = '1'; assert.strictEqual((await i.resolveSafe('127.0.0.1')).address, '127.0.0.1'); delete process.env.MARRAM_ALLOW_LOCAL_HOOKS;
});
