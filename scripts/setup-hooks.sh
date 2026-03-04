#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DRY_RUN=0
VERBOSE=0
BUN_MISSING_DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --verbose)
      VERBOSE=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

log() {
  if [[ "$VERBOSE" -eq 1 ]]; then
    printf '%s\n' "$*"
  fi
}

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] Bun not found; would install using https://bun.sh/install"
    BUN_MISSING_DRY_RUN=1
    return 0
  fi

  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"

  if ! command -v bun >/dev/null 2>&1; then
    echo "Bun install failed. Install manually: https://bun.sh/install" >&2
    exit 1
  fi
}

copy_hook() {
  local src="$1"
  local dest="$2"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] Would copy ${src} -> ${dest}"
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  install -m 755 "$src" "$dest"
  log "Copied hook: $dest"
}

ensure_bun

CLAUDE_HOOK_DEST="$HOME/.claude/hooks/dashboard-hook.sh"
CODEX_HOOK_DEST="$HOME/.codex/hooks/dashboard-hook.sh"

copy_hook "$ROOT_DIR/hooks/dashboard-hook-claude.sh" "$CLAUDE_HOOK_DEST"
copy_hook "$ROOT_DIR/hooks/dashboard-hook-codex.sh" "$CODEX_HOOK_DEST"

CLAUDE_SETTINGS=()
if [[ -f "$HOME/.claude/settings.json" ]]; then
  CLAUDE_SETTINGS+=("$HOME/.claude/settings.json")
fi
if [[ -f "$HOME/.config/claude/settings.json" ]]; then
  CLAUDE_SETTINGS+=("$HOME/.config/claude/settings.json")
fi
if [[ ${#CLAUDE_SETTINGS[@]} -eq 0 ]]; then
  CLAUDE_SETTINGS+=("$HOME/.claude/settings.json")
fi

CMD=(
  bun run "$ROOT_DIR/scripts/update-hook-config.ts"
  --codex-config "$HOME/.codex/config.toml"
  --codex-hook-path "~/.codex/hooks/dashboard-hook.sh"
  --claude-hook-command "~/.claude/hooks/dashboard-hook.sh"
)

for settings_path in "${CLAUDE_SETTINGS[@]}"; do
  CMD+=(--claude-settings "$settings_path")
done

if [[ "$BUN_MISSING_DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] Would run config updater: ${CMD[*]}"
  echo "Setup complete (dry-run)."
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  CMD+=(--dry-run)
fi
if [[ "$VERBOSE" -eq 1 ]]; then
  CMD+=(--verbose)
fi

"${CMD[@]}"

echo "Setup complete. Start dashboard: bun run dev"
