import { describe, expect, test } from "bun:test";
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
});
