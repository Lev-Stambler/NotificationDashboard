import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildAgentKey,
  classifyClaudeNotification,
  defaultNameFromPath,
  detectSource,
  eventToStatus,
  isHandledClaudeNotificationType,
  normalizePath,
  resolveSessionId
} from "../src/server/status-mapper";
import type { HookPayload } from "../src/server/types";

const readFixture = (name: string): HookPayload => {
  const path = join(import.meta.dir, "fixtures", "claude-notifications", name);
  return JSON.parse(readFileSync(path, "utf8")) as HookPayload;
};

describe("status-mapper", () => {
  test("normalizes project path and derives default name", () => {
    expect(normalizePath("/tmp/work/")).toBe("/tmp/work");
    expect(defaultNameFromPath("/tmp/work")).toBe("work");
    expect(buildAgentKey("claude", "/tmp/work")).toBe("claude:/tmp/work");
  });

  test("detects codex payloads", () => {
    expect(detectSource({ source: "opencode" })).toBe("opencode");
    expect(detectSource({ source: "codex" })).toBe("codex");
    expect(detectSource({ type: "agent-turn-complete" })).toBe("codex");
    expect(detectSource({ "thread-id": "abc" })).toBe("codex");
  });

  test("maps status transitions", () => {
    expect(eventToStatus("claude", "PreToolUse", Date.now(), "idling").status).toBe("working");
    expect(eventToStatus("claude", "PermissionRequest", Date.now(), "working").status).toBe("waiting");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "working", {
        message: "Waiting on a response from a tool"
      }).status
    ).toBe("background");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "working", {
        message: "Claude is running in the background"
      }).status
    ).toBe("background");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "waiting", {
        message: "Claude Code needs your approval for the plan",
        notification_type: "permission_prompt"
      }).status
    ).toBe("waiting");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "working", {
        message: "Claude needs your attention"
      }).status
    ).toBe("waiting");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "working", {
        message: "Claude is waiting for your input"
      }).status
    ).toBe("waiting");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "working", {
        notification_type: "idle_prompt"
      }).status
    ).toBe("waiting");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "working", {
        notification_type: "elicitation_dialog"
      }).status
    ).toBe("waiting");
    expect(eventToStatus("claude", "SessionEnd", Date.now(), "working").endedAt).not.toBeNull();
    expect(eventToStatus("codex", "agent-turn-complete", Date.now(), "working").status).toBe("waiting");
    expect(eventToStatus("opencode", "assistant_in_progress", Date.now(), "idling").status).toBe("working");
    expect(eventToStatus("opencode", "assistant_complete", Date.now(), "working").status).toBe("waiting");
  });

  test("resolves session IDs from codex and claude payloads", () => {
    expect(resolveSessionId({ session_id: "claude-1" })).toBe("claude-1");
    expect(resolveSessionId({ "thread-id": "codex-1" })).toBe("codex-1");
  });

  test("classifies Claude notification fixtures canonically", () => {
    const backgroundPayload = readFixture("background-running.json");
    const permissionPayload = readFixture("permission-prompt.json");
    const unhandledPayload = readFixture("unhandled-type.json");

    expect(classifyClaudeNotification(backgroundPayload)).toBe("background_active");
    expect(eventToStatus("claude", "Notification", Date.now(), "idling", backgroundPayload).status).toBe(
      "background"
    );

    expect(classifyClaudeNotification(permissionPayload)).toBe("user_wait");
    expect(isHandledClaudeNotificationType(permissionPayload)).toBe(true);
    expect(eventToStatus("claude", "Notification", Date.now(), "working", permissionPayload).status).toBe(
      "waiting"
    );

    expect(classifyClaudeNotification(unhandledPayload)).toBe("informational");
    expect(isHandledClaudeNotificationType(unhandledPayload)).toBe(false);
    expect(eventToStatus("claude", "Notification", Date.now(), "background", unhandledPayload).status).toBe(
      "background"
    );
  });
});
