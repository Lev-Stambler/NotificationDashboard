import type { AgentSource, AgentStatus, HookPayload } from "./types";

const TOOL_WAIT_NOTIFICATION_PATTERN = /waiting on a response from a tool/i;

export const isToolWaitNotification = (payload: HookPayload): boolean => {
  const message = typeof payload.message === "string" ? payload.message : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  return TOOL_WAIT_NOTIFICATION_PATTERN.test(message) || TOOL_WAIT_NOTIFICATION_PATTERN.test(title);
};

export const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "unknown";
  return trimmed.replace(/\/+$/, "") || "/";
};

export const defaultNameFromPath = (projectPath: string): string => {
  const normalized = normalizePath(projectPath);
  if (normalized === "unknown") return "unknown";
  const parts = normalized.split("/").filter(Boolean);
  return parts.length === 0 ? normalized : parts[parts.length - 1];
};

export const buildAgentKey = (source: AgentSource, projectPath: string): string => {
  return `${source}:${normalizePath(projectPath)}`;
};

export const detectSource = (payload: HookPayload): AgentSource => {
  if (payload.source === "opencode") return "opencode";
  if (payload.source === "codex") return "codex";
  if (payload.type === "agent-turn-complete") return "codex";
  if (typeof payload["thread-id"] === "string") return "codex";
  if (payload.codex_event === "agent-turn-complete") return "codex";
  return "claude";
};

export const resolveSessionId = (payload: HookPayload): string | null => {
  if (typeof payload.session_id === "string" && payload.session_id.length > 0) {
    return payload.session_id;
  }
  const threadId = payload["thread-id"];
  if (typeof threadId === "string" && threadId.length > 0) return threadId;
  return null;
};

export const eventToStatus = (
  source: AgentSource,
  hookEventName: string,
  now: number,
  currentStatus: AgentStatus,
  payload?: HookPayload
): { status: AgentStatus; endedAt: number | null } => {
  if (source === "codex") {
    if (hookEventName === "agent-turn-complete" || hookEventName === "Stop") {
      return { status: "waiting", endedAt: null };
    }
    return { status: currentStatus, endedAt: null };
  }

  if (source === "opencode") {
    if (hookEventName === "assistant_in_progress" || hookEventName === "user_message") {
      return { status: "working", endedAt: null };
    }
    if (hookEventName === "assistant_complete") {
      return { status: "waiting", endedAt: null };
    }
    return { status: currentStatus, endedAt: null };
  }

  switch (hookEventName) {
    case "SessionStart":
      return { status: "idling", endedAt: null };
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
      return { status: "working", endedAt: null };
    case "PermissionRequest":
    case "Stop":
      return { status: "waiting", endedAt: null };
    case "Notification":
      if (payload && isToolWaitNotification(payload)) {
        return { status: "working", endedAt: null };
      }
      return { status: "waiting", endedAt: null };
    case "SessionEnd":
      return { status: "idling", endedAt: now };
    default:
      return { status: currentStatus, endedAt: null };
  }
};
