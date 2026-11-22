# AgentHelm

A local, dependency-free web dashboard for [Claude Code](https://claude.com/claude-code). It reads the session transcripts Claude Code already keeps in `~/.claude` and gives you one page to manage all of them.

## Features
- All sessions across all projects, grouped by repo with worktrees nested under it; tag them active / later / revisit / done, rename, add notes; list and board views.
- **Live terminal**: runs the real `claude` CLI in a pseudo-terminal (xterm.js), so it looks and behaves like your terminal.
- **Chat viewer**: read any past conversation, search across every transcript.
- Code changes, commits and PRs per session; ticket grouping (optional).
- Worktree manager: scan, filter, and remove idle, dirty or missing worktrees safely.
- Skills: see usage, enable per folder, set defaults, discover and install from GitHub.
- Optimize: find idle `claude` processes and heavy transcripts; optional auto-close of stale sessions.
- Deep links: every view has a URL, e.g. `#/tickets`, `#/sessions?p=/path/to/repo`, `#/sessions?chat=<session id>`.

## Run
Requires Node 20+, `git`, `python3` (terminal view) and the `claude` CLI on your PATH. Optional: `gh` for PR info.

```
node server.js          # http://127.0.0.1:7777
node server.js --url    # prints the one-time sign-in link; open it once per browser
```

Config (environment variables): `PORT` (default 7777), `IDLE_DAYS` (default 30), `JIRA_BASE` and `TICKET_PREFIXES` to link ticket ids. See `claude-session-hub.service.example` to run it at login with systemd.

## Security model
It binds to `127.0.0.1` only, rejects other `Host` headers, and requires a sign-in: a random 256-bit token in `~/.claude/hub-token` (mode 600), exchanged once via `?k=` for an HttpOnly, SameSite=Strict cookie. Every API call also needs an `x-hub: 1` header, and the page is served with a strict CSP. It can start `claude` in folders under your home directory, delete worktrees you pick, and edit CLAUDE.md files, so do not expose it to a network or reverse-proxy it. Transcripts can contain secrets you pasted into chats; the viewer shows them as stored.

## Data it writes
`~/.claude/session-tags.json`, `~/.claude/hub-config.json`, `~/.claude/hub-skills/`, `~/.claude/hub-cache/`, `~/.claude/hub-backups/`. It never edits transcripts (the terminal's "resume from another folder" copies one).

## Tests
```
npm test
```
Uses Node's built-in test runner with a temporary HOME, so it never touches your real `~/.claude`.

## Layout
`server.js` (bootstrap) -> `lib/routes.js` (HTTP) -> `lib/{skills,worktrees,system}.js` -> `lib/sessions.js` -> `lib/core.js`; `index.html` is the whole UI; `pty-helper.py` backs the terminal view; `agents/skill-advisor.md` is an optional Claude Code subagent.
