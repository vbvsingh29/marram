'use strict';
// Messaging: send text to Slack (channel or person, through a bot token you create) or to any incoming webhook (Slack, Teams, Discord, generic).
// Everything is explicit and one message at a time: the UI asks you to confirm, and the server refuses a send without that confirmation.
// Secrets live in ~/.claude/hub-integrations.json (mode 600), are never returned by any API and are never injected into sessions.
// Slack needs a bot token (xoxb-...) with: chat:write, channels:read, groups:read, users:read, users:read.email (and chat:write.public to post
// in channels the app has not joined, im:write to message people). Teams: incoming webhook only (a webhook posts to the one channel it was made for).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net'), dns = require('dns'), https = require('https'), http = require('http');
const { HOME, cleanText } = require('./core');
const F = path.join(HOME, '.claude', 'hub-integrations.json');
const KINDS = ['slack', 'teams', 'discord', 'generic'], MAX_TEXT = 3500;
const read = () => { try { const o = JSON.parse(fs.readFileSync(F, 'utf8')); return { slackToken: String(o.slackToken || ''), hooks: Array.isArray(o.hooks) ? o.hooks : [] }; } catch { return { slackToken: '', hooks: [] }; } };
const write = o => { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(o, null, 2), { mode: 0o600 }); };
const api = () => process.env.MARRAM_SLACK_API || 'https://slack.com/api';

// Webhook addresses: https only, and never an address on this machine or a private/special network (Marram runs next to internal services).
// The check is done on the real IP addresses the name resolves to, and the connection then goes to exactly the address that was checked,
// so a name that points inside (or switches to inside later, DNS rebinding) cannot reach internal services.
const BLOCK = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, n, 'ipv6');
function v6groups(a) { // expand an IPv6 text address into 8 numbers (handles :: and a trailing dotted IPv4)
  let h = a.split('%')[0]; const m = h.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); if (m) { const p = m[2].split('.').map(Number); h = m[1] + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16); }
  const [l, r] = h.split('::'), L = l ? l.split(':') : [], R = r === undefined ? [] : (r ? r.split(':') : []), fill = r === undefined ? [] : Array(8 - L.length - R.length).fill('0'); return [...L, ...fill, ...R].map(x => parseInt(x || '0', 16));
}
const isBlockedIp = a => {
  const v = net.isIP(a); if (v === 0) return true; if (v === 4) return BLOCK.check(a, 'ipv4');
  const g = v6groups(a); if (g.length !== 8 || g.some(x => !Number.isFinite(x))) return true;
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return BLOCK.check(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, 'ipv4'); // IPv4 written as IPv6: judge the embedded address
  if (g.slice(0, 6).every(x => x === 0) && (g[6] || g[7])) return BLOCK.check(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, 'ipv4'); // deprecated IPv4-compatible form
  return BLOCK.check(a, 'ipv6');
};
function privateHost(h) { // quick check on the written address (names are checked again after DNS lookup)
  h = String(h).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
  return net.isIP(h) ? isBlockedIp(h) : false;
}
const localAllowed = () => process.env.MARRAM_ALLOW_LOCAL_HOOKS === '1';
async function resolveSafe(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, ''); let list;
  if (net.isIP(h)) list = [{ address: h, family: net.isIP(h) }]; else { try { list = await dns.promises.lookup(h, { all: true }); } catch { throw new Error('Could not find ' + h + '. Nothing was sent.'); } }
  if (!list.length) throw new Error('Could not find ' + h + '. Nothing was sent.');
  if (!localAllowed() && list.some(x => isBlockedIp(x.address))) throw new Error('That webhook address points to this computer or a private network, so it was not used. Nothing was sent.');
  return list[0];
}
// POST JSON to the checked address. No redirects are followed. TLS still verifies the original host name.
function postJson(url, payload) {
  return resolveSafe(new URL(url).hostname).then(addr => new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === 'http:' ? http : https, data = Buffer.from(JSON.stringify(payload));
    const rq = lib.request({ hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST', servername: net.isIP(u.hostname) ? undefined : u.hostname,
      headers: { 'content-type': 'application/json', 'content-length': data.length }, timeout: 15000, lookup: (h, o, cb) => (o && o.all) ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family) }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    rq.on('timeout', () => rq.destroy(new Error('timeout'))); rq.on('error', reject); rq.end(data);
  }));
}
function checkUrl(u) {
  let x; try { x = new URL(u); } catch { throw new Error('that is not a valid web address'); }
  const local = localAllowed();
  if (x.protocol !== 'https:' && !(local && x.protocol === 'http:')) throw new Error('webhook addresses must start with https://');
  if (!local && privateHost(x.hostname)) throw new Error('webhook addresses on this machine or a private network are not allowed');
  if (u.length > 600) throw new Error('address too long'); return x;
}
function status() { const c = read(); return { slack: { connected: !!c.slackToken }, hooks: c.hooks.map(h => ({ id: h.id, kind: h.kind, label: h.label, host: (() => { try { return new URL(h.url).hostname; } catch { return ''; } })() })) }; }
function setSlackToken(t) { t = String(t || '').trim(); if (!/^xox[bp]-[A-Za-z0-9-]{10,}$/.test(t)) throw new Error('paste a Slack bot token (it starts with xoxb-)'); const c = read(); c.slackToken = t; write(c); }
function clearSlack() { const c = read(); c.slackToken = ''; write(c); }
function addHook({ kind, label, url }) {
  if (!KINDS.includes(kind)) throw new Error('unknown kind'); const l = cleanText(label).trim().slice(0, 40); if (!l) throw new Error('give it a name');
  checkUrl(url); const c = read(); if (c.hooks.length >= 20) throw new Error('too many webhooks'); if (c.hooks.some(h => h.label === l)) throw new Error('a webhook with that name already exists');
  const h = { id: crypto.randomBytes(5).toString('hex'), kind, label: l, url: String(url).trim() }; c.hooks.push(h); write(c); return { id: h.id };
}
function delHook(id) { const c = read(); c.hooks = c.hooks.filter(h => h.id !== id); write(c); }

const HINTS = {
  invalid_auth: 'The Slack token is not valid. Paste the bot token (xoxb-...) again.', not_authed: 'No Slack token saved yet.', token_revoked: 'That Slack token was revoked. Create a new one.', account_inactive: 'That Slack account is deactivated.',
  missing_scope: 'The Slack app is missing a permission. Add the scopes listed in Library, then reinstall the app to your workspace.',
  channel_not_found: 'Slack cannot find that channel or person. For a private channel, invite the app first (/invite @your-app).',
  not_in_channel: 'The app is not in that channel. Invite it with /invite @your-app, or add the chat:write.public permission.',
  is_archived: 'That channel is archived.', msg_too_long: 'The message is too long for Slack.', no_text: 'There is no message text.', ratelimited: 'Slack asked us to slow down. Wait a minute and try again.',
  restricted_action: 'Your workspace settings do not allow the app to post there.', user_disabled: 'That person\'s account is deactivated.', cannot_dm_bot: 'Slack does not allow messages to that account.',
};
const SLACK_ERR = (e, needed) => { const err = new Error((HINTS[e] || 'Slack said: ' + e) + (e === 'missing_scope' && needed ? ' Needed: ' + needed + '.' : '')); err.code = e; return err; };
async function slack(method, params) {
  const c = read(); if (!c.slackToken) throw SLACK_ERR('not_authed');
  let r; try { r = await fetch(api() + '/' + method, { method: 'POST', headers: { authorization: 'Bearer ' + c.slackToken, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params || {}), signal: AbortSignal.timeout(15000) }); } catch { throw new Error('Could not reach Slack. Check your internet connection.'); }
  let j; try { j = await r.json(); } catch { throw new Error('Slack sent a reply Marram could not read (HTTP ' + r.status + ').'); }
  if (!j.ok) throw SLACK_ERR(j.error, j.needed); return j;
}
const slackTest = async () => { const j = await slack('auth.test'); return { workspace: j.team, as: j.user, url: j.url }; };

const cache = new Map();
async function pages(method, params, key, limitPages = 6) {
  const hit = cache.get(key); if (hit && Date.now() - hit.t < 300000) return hit.v;
  const out = []; let cursor = '';
  for (let i = 0; i < limitPages; i++) { const j = await slack(method, { ...params, limit: '200', ...(cursor ? { cursor } : {}) }); out.push(...(j[key.split(':')[0]] || [])); cursor = (j.response_metadata && j.response_metadata.next_cursor) || ''; if (!cursor) break; }
  cache.set(key, { t: Date.now(), v: out }); return out;
}
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
async function findChannels(q) {
  const all = await pages('conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true' }, 'channels:ch'), n = norm(q).replace(/^#/, '');
  return all.filter(c => !n || norm(c.name).includes(n)).slice(0, 15).map(c => ({ id: c.id, name: c.name, private: !!c.is_private, members: c.num_members || 0 }));
}
async function findPeople(q) {
  const all = await pages('users.list', {}, 'members:us'), n = norm(q).replace(/^@/, ''); if (!n) return [];
  const hit = all.filter(u => !u.deleted && !u.is_bot && u.id !== 'USLACKBOT').filter(u => [u.name, u.real_name, u.profile && u.profile.real_name, u.profile && u.profile.display_name, u.profile && u.profile.email].some(v => norm(v).includes(n)))
    .slice(0, 15).map(u => ({ id: u.id, name: (u.real_name || (u.profile && u.profile.real_name) || u.name || '').slice(0, 80), handle: (u.profile && u.profile.display_name) || u.name || '', email: (u.profile && u.profile.email) || '', title: (u.profile && u.profile.title) || '' }));
  const count = {}; for (const p of hit) count[norm(p.name)] = (count[norm(p.name)] || 0) + 1;
  return hit.map(p => ({ ...p, sameName: count[norm(p.name)] > 1 }));
}
const cleanMessage = t => cleanText(t).replace(/\r/g, '').trim().slice(0, MAX_TEXT);
async function sendSlack(to, text) {
  const t = cleanMessage(text); if (!t) throw SLACK_ERR('no_text'); if (!to || !/^[CGUWD][A-Z0-9]{6,}$/.test(String(to.id))) throw new Error('pick a channel or a person first');
  const j = await slack('chat.postMessage', { channel: to.id, text: t, unfurl_links: 'false' });
  let link = ''; try { const p = await slack('chat.getPermalink', { channel: j.channel, message_ts: j.ts }); link = p.permalink || ''; } catch {}
  return { ok: true, link, at: Date.now() };
}
const payload = (kind, t) => kind === 'teams' ? { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: t, wrap: true }] } }] }
  : kind === 'discord' ? { content: t.slice(0, 1900) } : { text: t };
async function sendHook(id, text) {
  const h = read().hooks.find(x => x.id === id); if (!h) throw new Error('that webhook no longer exists'); const t = cleanMessage(text); if (!t) throw new Error('there is no message text');
  checkUrl(h.url); let code; const host = new URL(h.url).hostname;
  try { code = await postJson(h.url, payload(h.kind, t)); } catch (e) { if (/Nothing was sent/.test(e.message)) throw e; throw new Error('Could not reach ' + host + '. Nothing was sent.'); }
  if (code >= 200 && code < 300) return { ok: true, label: h.label, status: code, at: Date.now() };
  throw new Error(`${h.label} answered HTTP ${code}${code === 404 || code === 410 ? ' (the webhook was probably deleted)' : code === 401 || code === 403 ? ' (the webhook address was rejected)' : code >= 300 && code < 400 ? ' (it tried to redirect, which is not followed)' : ''}. Nothing was sent.`);
}
// Email and Teams chat: Marram builds a ready draft link and opens it in YOUR Gmail / Outlook / Teams / mail app. You press Send there.
// No sign-in, no stored credentials, and Marram cannot tell whether you sent it.
const EMAIL = /^[^\s@,;<>()"']{1,64}@[^\s@,;<>()"']{1,190}\.[A-Za-z]{2,}$/;
function emails(list) { const a = String(list || '').split(/[,;\s]+/).filter(Boolean).slice(0, 10); for (const x of a) if (!EMAIL.test(x)) throw new Error('check this email address: ' + x.slice(0, 80)); if (!a.length) throw new Error('add at least one email address'); return a; }
const PROVIDERS = ['gmail', 'outlook', 'outlookcom', 'mailto', 'teams'];
function composeLink({ kind, to, subject, body }) {
  if (!PROVIDERS.includes(kind)) throw new Error('unknown mail provider'); const rcpt = emails(to), s = cleanText(subject).slice(0, 150), full = cleanMessage(body), e = encodeURIComponent;
  const mk = t => kind === 'gmail' ? `https://mail.google.com/mail/?view=cm&fs=1&to=${e(rcpt.join(','))}&su=${e(s)}&body=${e(t)}`
    : kind === 'outlook' ? `https://outlook.office.com/mail/deeplink/compose?to=${e(rcpt.join(';'))}&subject=${e(s)}&body=${e(t)}`
    : kind === 'outlookcom' ? `https://outlook.live.com/mail/deeplink/compose?to=${e(rcpt.join(';'))}&subject=${e(s)}&body=${e(t)}`
    : kind === 'teams' ? `https://teams.microsoft.com/l/chat/0/0?users=${e(rcpt.join(','))}&message=${e(t)}`
    : `mailto:${rcpt.map(e).join(',')}?subject=${e(s)}&body=${e(t)}`;
  let t = full, shortened = false; while (mk(t).length > 1900 && t.length > 40) { t = t.slice(0, Math.floor(t.length * 0.85)).replace(/\s+\S*$/, '') + '...'; shortened = true; }
  return { url: mk(t), shortened, to: rcpt };
}
module.exports = { isBlockedIp, resolveSafe, composeLink, emails, status, setSlackToken, clearSlack, addHook, delHook, slackTest, findChannels, findPeople, sendSlack, sendHook, checkUrl, privateHost, cleanMessage, KINDS, MAX_TEXT };
