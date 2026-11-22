# AgentHelm

One local dashboard for all your AI coding agent sessions. Reads what your agents already keep on disk, runs the real agent in a browser terminal, and manages worktrees, skills, rules and secrets. No dependencies, no build step, no telemetry. Binds to `127.0.0.1` only.

## Supported agents
| Agent | List sessions | Read chat | Resume / new in terminal | Notes |
|---|---|---|---|---|
| Claude Code | yes | yes | yes | full support: worktrees, skills, changes, handoff |
| Antigravity | yes (read-only) | no | no | titles and summaries from its notes; "open folder" button. Its chats are binary |
| Codex CLI | yes | yes | yes | **experimental**: written from the documented format, not yet verified on a real install |

Use the agent dropdown in the sidebar to filter. Agents that are not installed are greyed out.

## Features
- **Sessions** across all projects, grouped by repo with worktrees nested; status tags (active / later / revisit / done), rename, notes, feature / bug / chore type; list and board views.
- **+ New session**: pick an agent and a folder, then work in the real terminal (xterm.js) like in your own shell.
- **Chat viewer** and full-text search across transcripts. A **changes** button on each card shows files, commits and PRs.
- **Work items**: sessions grouped by ticket id (optional Jira link), GitHub issue / PR, or your own type tag.
- **Worktrees**: scan, filter and remove idle, dirty or missing worktrees safely.
- **Library**: global and per-project rules (`CLAUDE.md`), skills, and a secrets vault. Secrets are injected as environment variables into sessions started from the hub.
- **Skills** and **Hyped**: usage, enable per folder, defaults, and discover / preview / install skills from GitHub into a local library.
- **Optimize** at three levels: *session* (big and forgotten sessions), *token* (counts from your transcripts, skill context cost) and *system* (processes, memory).
- Deep links for every view, e.g. `#/sessions?a=antigravity`, `#/work`, `#/sessions?chat=<session id>`.

## Run
Requires Node 20+, `git`, `python3` (terminal view) and at least one agent CLI (`claude`, `codex`) or Antigravity data on this machine. Optional: `gh` for PR info.

```
node server.js          # http://127.0.0.1:7777 (in a terminal it prints the sign-in link)
npx github:vbvsingh29/agenthelm   # run without cloning
node server.js --url    # prints the one-time sign-in link; open it once per browser
```

Config (environment variables): `PORT` (default 7777), `IDLE_DAYS` (default 30), `JIRA_BASE` and `TICKET_PREFIXES` to link ticket ids. See `agenthelm.service.example` to run it at login with systemd.

## Security model
It binds to `127.0.0.1` only, rejects other `Host` headers, and requires a sign-in: a random 256-bit token in `~/.claude/hub-token` (mode 600), exchanged once via `?k=` for an HttpOnly, SameSite=Strict cookie. Every API call also needs an `x-hub: 1` header, and the page is served with a strict CSP. It can start `claude` in folders under your home directory, delete worktrees you pick, and edit CLAUDE.md files, so do not expose it to a network or reverse-proxy it. Transcripts can contain secrets you pasted into chats; the viewer shows them as stored.

## Data it writes
`~/.claude/session-tags.json`, `~/.claude/hub-config.json`, `~/.claude/hub-vault.json` (secrets, mode 600, plain text like `~/.git-credentials`), `~/.claude/hub-skills/`, `~/.claude/hub-cache/`, `~/.claude/hub-backups/`. It never edits transcripts (the terminal's "resume from another folder" copies one).

## Tests
```
npm test
```
Uses Node's built-in test runner with a temporary HOME, so it never touches your real `~/.claude`.

## Layout
`server.js` (bootstrap) -> `lib/routes.js` (HTTP) -> `lib/{skills,worktrees,system}.js` -> `lib/sessions.js` -> `lib/core.js`; `index.html` is the whole UI; `pty-helper.py` backs the terminal view; `agents/skill-advisor.md` is an optional Claude Code subagent.
