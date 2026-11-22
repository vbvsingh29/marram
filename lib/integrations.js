'use strict';
// Messaging: send text to Slack (channel or person, through a bot token you create) or to any incoming webhook (Slack, Teams, Discord, generic).
// Everything is explicit and one message at a time: the UI asks you to confirm, and the server refuses a send without that confirmation.
// Secrets live in ~/.claude/hub-integrations.json (mode 600), are never returned by any API and are never injected into sessions.
// Slack needs a bot token (xoxb-...) with: chat:write, channels:read, groups:read, users:read, users:read.email (and chat:write.public to post
// in channels the app has not joined, im:write to message people). Teams: incoming webhook only (a webhook posts to the one channel it was made for).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { HOME, cleanText } = require('./core');
const F = path.join(HOME, '.claude', 'hub-integrations.json');
const KINDS = ['slack', 'teams', 'discord', 'generic'], MAX_TEXT = 3500;
const read = () => { try { const o = JSON.parse(fs.readFileSync(F, 'utf8')); return { slackToken: String(o.slackToken || ''), hooks: Array.isArray(o.hooks) ? o.hooks : [] }; } catch { return { slackToken: '', hooks: [] }; } };
const write = o => { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(o, null, 2), { mode: 0o600 }); };
const api = () => process.env.MARRAM_SLACK_API || 'https://slack.com/api';

// webhook addresses: https only, and never an address on this machine or a private network (Marram runs next to internal services)
function privateHost(h) {
  h = String(h).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}
function checkUrl(u) {
  let x; try { x = new URL(u); } catch { throw new Error('that is not a valid web address'); }
  const local = process.env.MARRAM_ALLOW_LOCAL_HOOKS === '1';
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
  checkUrl(h.url); let r; try { r = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(h.kind, t)), signal: AbortSignal.timeout(15000), redirect: 'error' }); } catch { throw new Error('Could not reach ' + new URL(h.url).hostname + '. Nothing was sent.'); }
  if (r.ok) return { ok: true, label: h.label, status: r.status, at: Date.now() };
  const body = (await r.text().catch(() => '')).slice(0, 160).replace(/https?:\/\/\S+/g, '');
  throw new Error(`${h.label} answered HTTP ${r.status}${r.status === 404 || r.status === 410 ? ' (the webhook was probably deleted)' : r.status === 401 || r.status === 403 ? ' (the webhook address was rejected)' : ''}${body ? ': ' + body : ''}. Nothing was sent.`);
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
module.exports = { composeLink, emails, status, setSlackToken, clearSlack, addHook, delHook, slackTest, findChannels, findPeople, sendSlack, sendHook, checkUrl, privateHost, cleanMessage, KINDS, MAX_TEXT };
