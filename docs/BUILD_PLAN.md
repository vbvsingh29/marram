# Build plan: multi-agent session manager (working name: AgentDeck, see "Name" below)

Audience for v1: developers. Plain JavaScript modules, no framework, no build step, no runtime dependencies.
Terminal-only for running agents (no headless Send). Antigravity is list-only at first; Codex is experimental until tested on a real Codex install.

## Name
"AgentDeck" is already taken: npm `agentdeck` (mobile control for coding agents), GitHub `puritysb/AgentDeck` (302 stars, local dashboards for AI coding agents) and `asheshgoplani/agent-deck` (1,292 stars, terminal session manager). Same niche, so search results and trust would be confused.
Free on npm at time of check (2026-11-22) and with only small unrelated GitHub projects: `agenthelm`, `sessionhub`. Decide before Phase 0; the rename itself is one search-and-replace.

## Phase 0: foundations (do first, everything depends on it)
1. Rename: package.json name/bin, README, service file, systemd unit name, cookie and token file names (keep a migration that reads the old `~/.claude/hub-*` files once).
2. Agent adapter interface in `lib/agents/`: `{ id, label, installed(), list(), transcript(id, before, limit), resumeCmd(session), newCmd(cwd), capabilities }`. Normalised session shape: `{ agent, id, cwd, repo, title, first, last, mtime, status, running, bytes }`.
3. Move the existing Claude code behind `lib/agents/claude.js` with no behaviour change. All 9 tests must stay green.
4. Agent switcher state (All / Claude / Codex / Antigravity) in the URL hash and in the API (`?agent=`).

## Phase 1: agents
5. Claude adapter: full (list, chat viewer, terminal resume, worktrees, skills, vault env).
6. Antigravity adapter: read-only list from `~/.gemini/antigravity/brain/<id>/*.md` (title and summary from the plan files, time from mtime) and project mapping from `code_tracker/active/<project>_<hash>`. Button: "open folder in Antigravity" (`antigravity <dir>`). Conversations `.pb` are binary: not parsed.
7. Codex adapter (experimental): list and read from Codex's own session folder, resume with `codex resume <id>` in the terminal. Verify against a real install before calling it supported; show an "experimental" badge until then.
8. Capability flags drive the UI: hide chat viewer, resume or worktree actions for agents that cannot do them, instead of showing broken buttons.

## Phase 2: navigation and flows (your items 2 to 7, 11)
9. Remove the "New session" tab and the headless Send box and endpoints. Add a "+" button in the header: popup with folder picker (reuse /api/ls and mkdir), agent choice (installed agents only), then open the terminal in that folder and the user types the first prompt there.
10. Remove the "Code changes" tab. Keep a "changes" chip on each session card that opens a diff drawer; same data as now.
11. Tickets becomes "Work items": group by ticket id (configurable prefixes, optional Jira link), GitHub `#123` issue or PR refs, or a free tag; personal presets feature / bug / chore. No hard Jira dependency.
12. Worktrees: show owning agent per row; cleanup flows unchanged.
13. Sessions view: agent badge on cards, global and per-project views unchanged.

## Phase 3: Skills, Hyped, Optimize
14. Skills: card grid, source badges (global / plugin / library), usage count, one-click add to global or project. Claude only at first; other agents show "not supported".
15. Hyped: category chips, search, cards with stars/updated, install preview. Cache results; optional GitHub token setting to avoid the 10 requests per minute unauthenticated limit.
16. Optimize, three levels, each with one clear answer:
    - Session: large or idle sessions to compact or close.
    - Token: estimated cost by project, skill and tool; loaded-but-unused rules and skills. Labelled as estimates.
    - System: memory and processes (existing).

## Phase 4: UI and non-functional
17. Split index.html into native ES modules per tab under `web/` (no bundler). One CSS file of design tokens: spacing, radius, type scale, status colours, one accent per agent, light and dark.
18. Responsive layout (phone width), keyboard shortcuts, empty states, loading skeletons, no layout shift on poll (keep the silent-poll rule).
19. Security: keep localhost-only bind, token cookie, CSP, vault 0600 and reserved env-name blocklist; add a read-only mode switch and a bind check that refuses non-loopback addresses. No telemetry.
20. Install: `npx <name>` opens the browser already signed in (token handed over automatically, still required on the wire). Test on macOS and Windows with WSL.
21. CI: GitHub Action for `npm test` and a secret scan on every push.
22. README: demo GIF, why, install, supported agents table with honest status per capability, comparison with similar tools, security note, contributing guide. CHANGELOG.

## Order of work
Phase 0 -> Claude adapter regression check -> Phase 2 navigation changes (they only need the Claude adapter) -> Antigravity and Codex adapters -> Phase 3 -> Phase 4. Commit locally per step; push in batches (project push cadence).

## Open items
- Final name (above).
- Codex session format and resume command to be verified on a machine with Codex installed.
- Whether Antigravity ever exposes a readable or resumable chat format.
- Estimate accuracy for token cost; decide the model price table source.
