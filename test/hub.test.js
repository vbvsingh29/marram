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
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

test('HTTP guards: header, host and input validation', async () => {
  await new Promise(r => hub.server.listen(0, '127.0.0.1', r));
  const port = hub.server.address().port, H = { 'x-hub': '1', 'content-type': 'application/json' };
  try {
    assert.strictEqual((await req(port, 'GET', '/api/sessions')).status, 403, 'GET without header');
    assert.strictEqual((await req(port, 'GET', '/api/sessions', { 'x-hub': '1' })).status, 200);
    assert.strictEqual((await req(port, 'GET', '/api/sessions', { 'x-hub': '1', host: 'evil.example' })).status, 403, 'bad Host');
    assert.strictEqual((await req(port, 'POST', '/api/tag', { 'content-type': 'application/json' }, '{}')).status, 403, 'POST without header');
    const bad = await req(port, 'POST', '/api/send-stream', H, JSON.stringify({ id: '--bad', cwd: work, prompt: 'x' }));
    assert.match(bad.body, /bad session id/);
    const out = await req(port, 'POST', '/api/send-stream', H, JSON.stringify({ cwd: '/etc', prompt: 'x' }));
    assert.match(out.body, /cwd missing or outside home/);
  } finally { hub.server.close(); }
});
