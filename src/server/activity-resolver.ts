import { basename } from "node:path";
import type { AgentStatus } from "./types";

export interface OpenCodeSessionRow {
  id: string;
  directory: string;
  time_updated: number;
  latest_data: string | null;
  latest_part_data?: string | null;
}

export interface ClaudeTranscriptActivity {
  sessionId: string;
  cwd: string | null;
  status: AgentStatus;
  lastEvent: string;
  updatedAtMs: number;
}

const numberOrNull = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const safeJson = (input: string): unknown => {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const contentHasRunningTask = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!item || typeof item !== "object") return false;
    const content = (item as Record<string, unknown>).content;
    return typeof content === "string" && /<status>running<\/status>/i.test(content);
  });
};

export const resolveOpenCodeActivity = (row: OpenCodeSessionRow): {
  status: AgentStatus;
  lastEvent: string;
  updatedAtMs: number;
  cwd: string | null;
} => {
  let status: AgentStatus = "idling";
  let lastEvent = "session_activity";
  let updatedAtMs = row.time_updated;
  let cwd: string | null = row.directory || null;

  if (row.latest_part_data) {
    const latestPart = safeJson(row.latest_part_data);
    if (latestPart && typeof latestPart === "object") {
      const payload = latestPart as Record<string, unknown>;
      const state = payload.state;
      if (state && typeof state === "object") {
        const statusValue = (state as Record<string, unknown>).status;
        const time = (state as Record<string, unknown>).time;
        if (time && typeof time === "object") {
          const start = numberOrNull((time as Record<string, unknown>).start);
          const end = numberOrNull((time as Record<string, unknown>).end);
          if (start !== null && start > updatedAtMs) updatedAtMs = start;
          if (end !== null && end > updatedAtMs) updatedAtMs = end;
        }

        if (statusValue === "pending" || statusValue === "waiting" || statusValue === "requires_input") {
          status = "waiting";
          lastEvent = "permission_request";
        } else if (statusValue === "running") {
          status = "working";
          lastEvent = "tool_running";
        }
      }
    }
  }

  if (!row.latest_data) {
    return { status, lastEvent, updatedAtMs, cwd };
  }

  const parsed = safeJson(row.latest_data);
  if (!parsed || typeof parsed !== "object") {
    return { status, lastEvent, updatedAtMs, cwd };
  }

  const payload = parsed as Record<string, unknown>;
  const role = typeof payload.role === "string" ? payload.role : null;

  const path = payload.path;
  if (path && typeof path === "object") {
    const candidate = (path as Record<string, unknown>).cwd;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      cwd = candidate;
    }
  }

  const time = payload.time;
  if (time && typeof time === "object") {
    const timeRecord = time as Record<string, unknown>;
    const created = numberOrNull(timeRecord.created);
    const completed = numberOrNull(timeRecord.completed);

    if (created !== null && created > updatedAtMs) updatedAtMs = created;
    if (completed !== null && completed > updatedAtMs) updatedAtMs = completed;

    if (role === "assistant") {
      if (completed === null) {
        status = "working";
        lastEvent = "assistant_in_progress";
      } else if (lastEvent === "session_activity") {
        status = "idling";
        lastEvent = "assistant_complete";
      }
    } else if (role === "user") {
      status = "working";
      lastEvent = "user_message";
    }
  }

  return { status, lastEvent, updatedAtMs, cwd };
};

export const resolveClaudeTranscriptActivity = (
  rawLine: string,
  fallbackUpdatedAtMs: number
): ClaudeTranscriptActivity | null => {
  const parsed = safeJson(rawLine);
  if (!parsed || typeof parsed !== "object") return null;

  const payload = parsed as Record<string, unknown>;
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
  if (!sessionId) return null;

  const cwd = typeof payload.cwd === "string" ? payload.cwd : null;
  const updatedAtMs = parseTimestamp(payload.timestamp) ?? fallbackUpdatedAtMs;

  if (payload.type === "progress") {
    const data = payload.data;
    if (data && typeof data === "object") {
      const progressType = typeof (data as Record<string, unknown>).type === "string"
        ? ((data as Record<string, unknown>).type as string)
        : null;

      if (progressType === "waiting_for_task") {
        return { sessionId, cwd, status: "background", lastEvent: "waiting_for_task", updatedAtMs };
      }
      if (progressType === "agent_progress") {
        return { sessionId, cwd, status: "background", lastEvent: "agent_progress", updatedAtMs };
      }
      if (progressType === "hook_progress") {
        const hookEvent = typeof (data as Record<string, unknown>).hookEvent === "string"
          ? ((data as Record<string, unknown>).hookEvent as string)
          : null;
        if (hookEvent === "PermissionRequest") {
          return { sessionId, cwd, status: "waiting", lastEvent: "permission_request", updatedAtMs };
        }
        if (hookEvent === "Stop" || hookEvent === "SessionEnd") {
          return { sessionId, cwd, status: "idling", lastEvent: hookEvent.toLowerCase(), updatedAtMs };
        }
        if (hookEvent === "PreToolUse" || hookEvent === "SubagentStart") {
          return { sessionId, cwd, status: "background", lastEvent: hookEvent.toLowerCase(), updatedAtMs };
        }
      }
    }
  }

  const message = payload.message;
  if (!message || typeof message !== "object") return null;
  const role = typeof (message as Record<string, unknown>).role === "string"
    ? ((message as Record<string, unknown>).role as string)
    : null;

  if (role === "assistant") {
    const stopReason = typeof (message as Record<string, unknown>).stop_reason === "string"
      ? ((message as Record<string, unknown>).stop_reason as string)
      : null;
    const content = (message as Record<string, unknown>).content;
    if (stopReason === "tool_use") {
      return { sessionId, cwd, status: "background", lastEvent: "transcript_tool_use", updatedAtMs };
    }
    if (Array.isArray(content) && content.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "tool_use")) {
      return { sessionId, cwd, status: "background", lastEvent: "transcript_tool_use", updatedAtMs };
    }
    return { sessionId, cwd, status: "idling", lastEvent: "assistant_complete", updatedAtMs };
  }

  if (role === "user") {
    const content = (message as Record<string, unknown>).content;
    if (contentHasRunningTask(content)) {
      return { sessionId, cwd, status: "background", lastEvent: "task_running", updatedAtMs };
    }
    return { sessionId, cwd, status: "working", lastEvent: "user_message", updatedAtMs };
  }

  return null;
};

export const resolveLatestClaudeTranscriptActivity = (
  lines: string[],
  fallbackUpdatedAtMs: number
): ClaudeTranscriptActivity | null => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    const activity = resolveClaudeTranscriptActivity(line, fallbackUpdatedAtMs);
    if (activity) return activity;
  }

  return null;
};

export const sessionIdFromTranscriptPath = (filePath: string): string | null => {
  const name = basename(filePath);
  return name.endsWith(".jsonl") ? name.slice(0, -6) : null;
};
