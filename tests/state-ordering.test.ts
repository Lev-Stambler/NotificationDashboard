import { describe, expect, test } from "bun:test";
import { DashboardState } from "../src/server/state";

describe("DashboardState ordering", () => {
  test("keeps order stable when switching from working to background", () => {
    const state = new DashboardState({}, []);

    state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "older",
        cwd: "/tmp/older"
      },
      1_000
    );
    state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "newer",
        cwd: "/tmp/newer"
      },
      2_000
    );

    const updated = state.applyHook(
      {
        source: "claude",
        hook_event_name: "Notification",
        session_id: "older",
        cwd: "/tmp/older",
        message: "Claude is running in the background"
      },
      3_000
    );

    expect(updated?.status).toBe("background");
    expect(updated?.lastActivityAt).toBe(3_000);
    expect(state.visibleSessions(3_000).map((session) => session.sessionId)).toEqual(["newer", "older"]);
  });

  test("keeps order stable when switching from background to working", () => {
    const state = new DashboardState({}, []);

    state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "older",
        cwd: "/tmp/older"
      },
      1_000
    );
    state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "newer",
        cwd: "/tmp/newer"
      },
      2_000
    );
    state.applyHook(
      {
        source: "claude",
        hook_event_name: "Notification",
        session_id: "older",
        cwd: "/tmp/older",
        message: "Claude is running in the background"
      },
      3_000
    );

    const updated = state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "older",
        cwd: "/tmp/older"
      },
      4_000
    );

    expect(updated?.status).toBe("working");
    expect(updated?.lastActivityAt).toBe(4_000);
    expect(state.visibleSessions(4_000).map((session) => session.sessionId)).toEqual(["newer", "older"]);
  });

  test("reorders when switching into a different status family", () => {
    const state = new DashboardState({}, []);

    state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "older",
        cwd: "/tmp/older"
      },
      1_000
    );
    state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "newer",
        cwd: "/tmp/newer"
      },
      2_000
    );

    const updated = state.applyHook(
      {
        source: "claude",
        hook_event_name: "Notification",
        session_id: "older",
        cwd: "/tmp/older",
        notification_type: "permission_prompt",
        message: "Claude Code needs your approval"
      },
      3_000
    );

    expect(updated?.status).toBe("waiting");
    expect(state.visibleSessions(3_000).map((session) => session.sessionId)).toEqual(["older", "newer"]);
  });
});
