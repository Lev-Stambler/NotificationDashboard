# Agent Notify Dashboard

A self-contained Bun dashboard for local Claude + Codex + OpenCode session status.

## What it shows
- `Working`
- `Background + Working`
- `Waiting for answer`
- `Idling`
- Hide/unhide windows (auto-unhide on fresh activity)

Default agent name is the workspace folder name. Names can be renamed in the UI and are persisted in host config.

## Stack
- Bun runtime
- Hono server
- React frontend
- WebSocket live updates

## Quick start
```bash
bun install
bun run setup-hooks
bun run dev
```

Open: `http://localhost:3333`

## Hook setup behavior
`bun run setup-hooks`:
- Installs Bun if missing
- Copies hooks to:
  - `~/.claude/hooks/dashboard-hook.sh`
  - `~/.codex/hooks/dashboard-hook.sh`
- Additively patches config (idempotent):
  - Claude settings JSON hook events
  - Codex `notify = ["~/.codex/hooks/dashboard-hook.sh"]`
- Creates backups before edits

Options:
```bash
bash scripts/setup-hooks.sh --dry-run --verbose
```

## Persistence
By default:
- Names: `~/.config/agent-notify-dashboard/names.json`
- Recent cache: `~/.config/agent-notify-dashboard/state-cache.json`
- Hidden windows: `~/.config/agent-notify-dashboard/hidden.json`

Override with env:
- `DASH_CONFIG_DIR`
- `DASH_QUEUE_FILE`
- `DASH_RECENT_TTL_MINUTES`
- `DASH_STALE_DAYS`

## Development scripts
```bash
bun run build:client
bun run dev
bun run start
bun run test
```

## Notes on Codex status
Codex notify hooks are completion-oriented, so the dashboard combines:
- completion hook events (`waiting`),
- Codex history activity (`working`),
- PID/inactivity timeout heuristics (`idling`).
