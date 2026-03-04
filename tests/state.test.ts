import { describe, expect, test } from "bun:test";
import { SETTINGS } from "../src/server/config";
import { DashboardState } from "../src/server/state";

describe("DashboardState", () => {
  test("applies hook and supports rename/reset", () => {
    const state = new DashboardState({}, []);
    const session = state.applyHook({
      source: "claude",
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/tmp/my-project"
    });

    expect(session).not.toBeNull();
    expect(session?.defaultName).toBe("my-project");

    const renamed = state.rename(session!.agentKey, "Backend Bot");
    expect(renamed?.customName).toBe("Backend Bot");

    const reset = state.rename(session!.agentKey, null);
    expect(reset?.customName).toBeNull();
  });

  test("tracks codex thread activity without hook mapping", () => {
    const state = new DashboardState({}, []);
    const session = state.applyCodexThreadActivity({
      threadId: "thread-1",
      cwd: "/tmp/codex-project",
      updatedAtMs: 1_700_000_000_000
    });

    expect(session).not.toBeNull();
    expect(session?.source).toBe("codex");
    expect(session?.sessionId).toBe("thread-1");
    expect(session?.status).toBe("working");
    expect(session?.lastEvent).toBe("thread_activity");
  });

  test("tracks opencode assistant completion as waiting", () => {
    const state = new DashboardState({}, []);
    const session = state.applyOpenCodeActivity({
      sessionId: "oc-1",
      cwd: "/tmp/open-code-project",
      status: "waiting",
      lastEvent: "assistant_complete",
      updatedAtMs: 1_700_000_000_500
    });

    expect(session).not.toBeNull();
    expect(session?.source).toBe("opencode");
    expect(session?.sessionId).toBe("oc-1");
    expect(session?.status).toBe("waiting");
    expect(session?.lastEvent).toBe("assistant_complete");
  });

  test("supports hiding and auto-unhides on new activity", () => {
    const state = new DashboardState({}, []);
    const session = state.applyHook(
      {
        source: "claude",
        hook_event_name: "SessionStart",
        session_id: "s-hide",
        cwd: "/tmp/hide-project"
      },
      1_000
    );

    expect(session).not.toBeNull();
    const hidden = state.hide(session!.agentKey);
    expect(hidden?.hidden).toBe(true);
    expect(state.visibleSessions(1_000)).toHaveLength(0);
    expect(state.hiddenSessions(1_000)).toHaveLength(1);

    const revived = state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "s-hide",
        cwd: "/tmp/hide-project"
      },
      2_000
    );

    expect(revived?.hidden).toBe(false);
    expect(state.visibleSessions(2_000)).toHaveLength(1);
    expect(state.hiddenSessions(2_000)).toHaveLength(0);
  });

  test("filters stale sessions older than two days", () => {
    const state = new DashboardState({}, []);
    state.applyOpenCodeActivity({
      sessionId: "stale-1",
      cwd: "/tmp/stale-project",
      status: "waiting",
      lastEvent: "assistant_complete",
      updatedAtMs: 1_000
    });

    const threeDaysLater = 1_000 + 3 * 24 * 60 * 60 * 1_000;
    expect(state.visibleSessions(threeDaysLater)).toHaveLength(0);
  });

  test("timeout transitions do not refresh last activity timestamp", () => {
    const state = new DashboardState({}, []);
    const session = state.applyHook(
      {
        source: "claude",
        hook_event_name: "PreToolUse",
        session_id: "s-timeout",
        cwd: "/tmp/timeout-project"
      },
      5_000
    );

    expect(session?.status).toBe("working");

    const tickResult = state.tick(5_000 + SETTINGS.workingToIdleMs + 10);
    expect(tickResult.updated).toHaveLength(1);
    expect(tickResult.updated[0]?.status).toBe("idling");
    expect(tickResult.updated[0]?.lastActivityAt).toBe(5_000);
  });

  test("keeps tool-wait notifications as working while pid is alive", () => {
    const state = new DashboardState({}, []);
    const start = 20_000;

    const session = state.applyHook(
      {
        source: "claude",
        hook_event_name: "Notification",
        session_id: "s-tool-wait-live",
        cwd: "/tmp/tool-wait-live",
        message: "Waiting on a response from a tool",
        claude_pid: process.pid
      },
      start
    );

    expect(session?.status).toBe("working");
    expect(session?.lastEvent).toBe("notification_tool_wait");

    const tickResult = state.tick(start + SETTINGS.workingToIdleMs + 10);
    expect(tickResult.updated).toHaveLength(0);

    const visible = state.visibleSessions(start + SETTINGS.workingToIdleMs + 10);
    expect(visible[0]?.status).toBe("working");
    expect(visible[0]?.lastEvent).toBe("notification_tool_wait");
  });

  test("idles tool-wait notifications when pid is dead", () => {
    const state = new DashboardState({}, []);
    const start = 30_000;

    state.applyHook(
      {
        source: "claude",
        hook_event_name: "Notification",
        session_id: "s-tool-wait-dead",
        cwd: "/tmp/tool-wait-dead",
        message: "Waiting on a response from a tool",
        claude_pid: 999_999
      },
      start
    );

    const tickResult = state.tick(start + 100);
    expect(tickResult.updated).toHaveLength(1);
    expect(tickResult.updated[0]?.status).toBe("idling");
    expect(tickResult.updated[0]?.lastEvent).toBe("pid_dead");
  });
});
