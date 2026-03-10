import { describe, expect, test } from "bun:test";
import {
  compareSessionsByDisplayOrder,
  nextSortActivityAt,
  shouldPreserveCardPosition
} from "../src/shared/session-order";

describe("session order", () => {
  test("keeps card position across working and background switches", () => {
    expect(shouldPreserveCardPosition("working", "background")).toBe(true);
    expect(shouldPreserveCardPosition("background", "working")).toBe(true);
    expect(shouldPreserveCardPosition("working", "waiting")).toBe(false);
    expect(shouldPreserveCardPosition("background", "idling")).toBe(false);
  });

  test("preserves sort timestamp for active-only switches", () => {
    expect(nextSortActivityAt({ status: "working", sortActivityAt: 2_000 }, "background", 5_000)).toBe(2_000);
    expect(nextSortActivityAt({ status: "background", sortActivityAt: 2_000 }, "working", 5_000)).toBe(2_000);
    expect(nextSortActivityAt({ status: "background", sortActivityAt: 2_000 }, "waiting", 5_000)).toBe(5_000);
  });

  test("sorts sessions by stable sort timestamp", () => {
    const ordered = [
      {
        agentKey: "b",
        sortActivityAt: 2_000,
        lastActivityAt: 9_000
      },
      {
        agentKey: "a",
        sortActivityAt: 2_000,
        lastActivityAt: 1_000
      },
      {
        agentKey: "c",
        sortActivityAt: 5_000,
        lastActivityAt: 5_000
      }
    ].sort(compareSessionsByDisplayOrder);

    expect(ordered.map((session) => session.agentKey)).toEqual(["c", "a", "b"]);
  });
});
