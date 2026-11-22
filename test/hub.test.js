const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
process.env.HOME = home; // must be set before server.js is loaded
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
    assert.strictEqual((fs.statSync(path.join(home, '.claude', 'hub-token')).mode & 0o777), 0o600, 'token file is private');
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
  assert.strictEqual(fs.statSync(v.VF).mode & 0o777, 0o600);
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

test('codex adapter (experimental): lists, reads transcript, builds resume command', () => {
  const cx = require('../lib/agents/codex'), id = 'bbbbbbbb-1111-2222-3333-444444444444', d = path.join(home, '.codex', 'sessions', '2026', '11', '22'); fs.mkdirSync(d, { recursive: true });
  const L = [{ timestamp: '2026-11-22T10:00:00Z', type: 'session_meta', payload: { id, cwd: work } },
    { timestamp: '2026-11-22T10:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
    { timestamp: '2026-11-22T10:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rename the helper' }] } },
    { timestamp: '2026-11-22T10:00:03Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } }];
  fs.writeFileSync(path.join(d, 'rollout-2026-11-22T10-00-00-' + id + '.jsonl'), L.map(x => JSON.stringify(x)).join('\n') + '\n');
  const s = cx.list().sessions.find(x => x.id === id);
  assert.strictEqual(s.agent, 'codex'); assert.strictEqual(s.cwd, work); assert.strictEqual(s.first, 'rename the helper'); assert.strictEqual(s.lastAssistant, 'Done.');
  const t = cx.transcript(id, 0, 50); assert.deepStrictEqual(t.msgs.map(m => m.r), ['u', 'a']);
  assert.deepStrictEqual(cx.resumeCmd({ id }), ['codex', 'resume', id]); assert.ok(cx.experimental); assert.ok(cx.installed());
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
  assert.strictEqual(fs.statSync(path.join(home, '.claude', 'hub-notes.json')).mode & 0o777, 0o600);
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
