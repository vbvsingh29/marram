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
    assert.match((await req(port, 'POST', '/api/send-stream', H, JSON.stringify({ id: '--bad', cwd: work, prompt: 'x' }))).body, /bad session id/);
    assert.match((await req(port, 'POST', '/api/send-stream', H, JSON.stringify({ cwd: '/etc', prompt: 'x' }))).body, /cwd missing or outside home/);
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
