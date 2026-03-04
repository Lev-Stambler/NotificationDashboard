#!/usr/bin/env bash
set -euo pipefail

QUEUE_FILE="${AGENT_DASHBOARD_QUEUE_FILE:-/tmp/agent-dashboard/queue.jsonl}"
SENT_AT_MS=$(($(date +%s) * 1000))
INPUT="{}"

if [ ! -t 0 ]; then
  INPUT=$(cat)
fi

{
  mkdir -p "$(dirname "$QUEUE_FILE")"
  touch "$QUEUE_FILE"

  if command -v jq >/dev/null 2>&1; then
    ENRICHED=$(printf '%s' "$INPUT" | jq -c \
      --arg source "claude" \
      --arg pid "$PPID" \
      --argjson sent_at "$SENT_AT_MS" \
      '. + {
        source: $source,
        claude_pid: ($pid | tonumber),
        hook_sent_at: $sent_at
      }' 2>/dev/null || printf '%s' "$INPUT")
  else
    ENRICHED="$INPUT"
  fi

  if ! printf '%s\n' "$ENRICHED" >> "$QUEUE_FILE" 2>/dev/null; then
    curl -s --connect-timeout 1 -m 3 -X POST \
      -H "Content-Type: application/json" \
      --data-binary "$ENRICHED" \
      http://localhost:3333/api/hooks >/dev/null 2>&1 || true
  fi
} >/dev/null 2>&1 &

disown || true
exit 0
