import type { AgentSource, AgentStatus, HookPayload } from "./types";

const TOOL_WAIT_NOTIFICATION_PATTERN = /waiting on a response from a tool/i;
const BACKGROUND_NOTIFICATION_PATTERN = /running in the background|in the background/i;
const IDLE_PROMPT_NOTIFICATION_PATTERN = /waiting for your input/i;
const ATTENTION_NOTIFICATION_PATTERN = /needs your attention|needs your approval|needs permission/i;

export type ClaudeNotificationKind =
  | "background_active"
  | "user_wait"
  | "informational"
  | "unknown";

export const HANDLED_CLAUDE_NOTIFICATION_TYPES = [
  "idle_prompt",
  "permission_prompt",
  "elicitation_dialog",
  "auth_success"
] as const;

const HANDLED_CLAUDE_NOTIFICATION_TYPE_SET = new Set<string>(HANDLED_CLAUDE_NOTIFICATION_TYPES);

const normalizedNotificationType = (payload: HookPayload): string | null => {
  return typeof payload.notification_type === "string" && payload.notification_type.length > 0
    ? payload.notification_type
    : null;
};

export const isHandledClaudeNotificationType = (payload: HookPayload): boolean => {
  const notificationType = normalizedNotificationType(payload);
  return notificationType !== null && HANDLED_CLAUDE_NOTIFICATION_TYPE_SET.has(notificationType);
};

export const classifyClaudeNotification = (payload: HookPayload): ClaudeNotificationKind => {
  const notificationType = normalizedNotificationType(payload);
  const message = typeof payload.message === "string" ? payload.message : "";
  const title = typeof payload.title === "string" ? payload.title : "";

  if (notificationType === "idle_prompt") return "user_wait";
  if (notificationType === "permission_prompt") return "user_wait";
  if (notificationType === "elicitation_dialog") return "user_wait";

  if (TOOL_WAIT_NOTIFICATION_PATTERN.test(message) || TOOL_WAIT_NOTIFICATION_PATTERN.test(title)) {
    return "background_active";
  }
  if (BACKGROUND_NOTIFICATION_PATTERN.test(message) || BACKGROUND_NOTIFICATION_PATTERN.test(title)) {
    return "background_active";
  }
  if (IDLE_PROMPT_NOTIFICATION_PATTERN.test(message) || IDLE_PROMPT_NOTIFICATION_PATTERN.test(title)) {
    return "user_wait";
  }
  if (ATTENTION_NOTIFICATION_PATTERN.test(message) || ATTENTION_NOTIFICATION_PATTERN.test(title)) {
    return "user_wait";
  }

  if (notificationType === "auth_success") return "informational";
  if (notificationType !== null) return "informational";
  return "unknown";
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
      return { status: "idling", endedAt: null };
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
      return { status: "waiting", endedAt: null };
    case "Stop":
      return { status: "idling", endedAt: null };
    case "Notification":
      if (payload) {
        const notificationKind = classifyClaudeNotification(payload);
        if (notificationKind === "background_active") {
          return { status: "background", endedAt: null };
        }
        if (notificationKind === "user_wait") {
          return { status: "waiting", endedAt: null };
        }
      }
      return { status: currentStatus, endedAt: null };
    case "SessionEnd":
      return { status: "idling", endedAt: now };
    default:
      return { status: currentStatus, endedAt: null };
  }
};
