'use strict';
// Pull request and check status for a session's branch. GitHub only. A GITHUB_TOKEN secret in the vault lets it see private repos and raises the rate limit.
const { okCwd, git } = require('./core');
const cache = new Map();
const token = () => { try { return require('./vault').vaultResolve('GITHUB_TOKEN'); } catch { return ''; } };
const parse = url => { const m = String(url).match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/); return m ? { owner: m[1], repo: m[2] } : null; };
async function gh(p) { const t = token(), r = await fetch('https://api.github.com' + p, { headers: { 'user-agent': 'marram', accept: 'application/vnd.github+json', ...(t ? { authorization: 'Bearer ' + t } : {}) } }); if (!r.ok) { const e = new Error(String(r.status)); e.status = r.status; throw e; } return r.json(); }
async function prStatus(cwd) {
  const dir = okCwd(cwd), branch = git(dir, ['branch', '--show-current']), remote = parse(git(dir, ['remote', 'get-url', 'origin']));
  if (!remote) return { error: 'PR status works for GitHub repos only' }; if (!branch) return { error: 'no branch checked out here' };
  const key = remote.owner + '/' + remote.repo + '#' + branch, hit = cache.get(key); if (hit && Date.now() - hit.t < 300000) return hit.v;
  let v;
  try {
    const prs = await gh(`/repos/${remote.owner}/${remote.repo}/pulls?head=${encodeURIComponent(remote.owner + ':' + branch)}&state=all&per_page=1`);
    if (!prs.length) v = { branch, pr: null }; else {
      const p = prs[0]; let checks = 'none';
      try { const c = await gh(`/repos/${remote.owner}/${remote.repo}/commits/${p.head.sha}/check-runs?per_page=100`), runs = c.check_runs || [];
        if (runs.length) checks = runs.some(r => r.status !== 'completed') ? 'running' : runs.every(r => ['success', 'neutral', 'skipped'].includes(r.conclusion)) ? 'passing' : 'failing'; } catch {}
      v = { branch, pr: { number: p.number, title: p.title.slice(0, 120), state: p.merged_at ? 'merged' : p.draft ? 'draft' : p.state, url: p.html_url, checks } };
    }
  } catch (e) { v = { error: e.status === 404 ? 'repo not visible: save a GITHUB_TOKEN secret in the Library to see private repos' : e.status === 403 ? 'GitHub rate limit reached: save a GITHUB_TOKEN secret in the Library' : 'could not reach GitHub' }; }
  cache.set(key, { t: Date.now(), v }); return v;
}
module.exports = { prStatus, parse };
