import { describe, expect, test } from "bun:test";
import {
  resolveClaudeTranscriptActivity,
  resolveLatestClaudeTranscriptActivity,
  resolveOpenCodeActivity
} from "../src/server/activity-resolver";

describe("activity-resolver", () => {
  test("detects Claude waiting_for_task transcript entries as background", () => {
    const line = JSON.stringify({
      type: "progress",
      sessionId: "claude-1",
      cwd: "/tmp/project",
      timestamp: "2026-03-09T19:41:30.011Z",
      data: {
        type: "waiting_for_task",
        taskDescription: "Run semi-smoke test on Modal",
        taskType: "local_bash"
      }
    });

    const activity = resolveClaudeTranscriptActivity(line, 0);
    expect(activity).not.toBeNull();
    expect(activity?.status).toBe("background");
    expect(activity?.lastEvent).toBe("waiting_for_task");
  });

  test("finds latest meaningful Claude transcript activity from the tail", () => {
    const activity = resolveLatestClaudeTranscriptActivity(
      [
        JSON.stringify({ type: "last-prompt", sessionId: "claude-1" }),
        JSON.stringify({
          type: "progress",
          sessionId: "claude-1",
          cwd: "/tmp/project",
          timestamp: "2026-03-09T19:53:09.492Z",
          data: {
            type: "waiting_for_task",
            taskDescription: "Run semi-smoke test on Modal",
            taskType: "local_bash"
          }
        }),
        JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId: "claude-1" })
      ],
      0
    );

    expect(activity).not.toBeNull();
    expect(activity?.status).toBe("background");
    expect(activity?.lastEvent).toBe("waiting_for_task");
  });

  test("treats completed Claude assistant transcript entries as idle", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "claude-2",
      cwd: "/tmp/project",
      timestamp: "2026-03-09T19:42:00.000Z",
      message: {
        role: "assistant",
        stop_reason: null,
        content: [{ type: "text", text: "Done." }]
      }
    });

    const activity = resolveClaudeTranscriptActivity(line, 0);
    expect(activity?.status).toBe("idling");
    expect(activity?.lastEvent).toBe("assistant_complete");
  });

  test("maps opencode pending part state to waiting", () => {
    const activity = resolveOpenCodeActivity({
      id: "oc-1",
      directory: "/tmp/opencode",
      time_updated: 100,
      latest_data: null,
      latest_part_data: JSON.stringify({
        type: "tool",
        state: {
          status: "pending",
          time: { start: 200 }
        }
      })
    });

    expect(activity.status).toBe("waiting");
    expect(activity.lastEvent).toBe("permission_request");
    expect(activity.updatedAtMs).toBe(200);
  });

  test("treats completed opencode assistant messages as idle", () => {
    const activity = resolveOpenCodeActivity({
      id: "oc-2",
      directory: "/tmp/opencode",
      time_updated: 100,
      latest_part_data: null,
      latest_data: JSON.stringify({
        role: "assistant",
        time: {
          created: 150,
          completed: 175
        }
      })
    });

    expect(activity.status).toBe("idling");
    expect(activity.lastEvent).toBe("assistant_complete");
  });
});
