import { describe, expect, test } from "bun:test";
import {
  buildAgentKey,
  defaultNameFromPath,
  detectSource,
  eventToStatus,
  normalizePath,
  resolveSessionId
} from "../src/server/status-mapper";

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
    ).toBe("working");
    expect(
      eventToStatus("claude", "Notification", Date.now(), "working", {
        message: "Claude needs permission"
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
});
