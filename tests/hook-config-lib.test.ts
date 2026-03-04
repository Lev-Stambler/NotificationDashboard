import { describe, expect, test } from "bun:test";
import { patchClaudeSettings, patchCodexConfig } from "../scripts/hook-config-lib";

describe("hook-config-lib", () => {
  test("patches Claude settings additively and idempotently", () => {
    const hookCommand = "~/.claude/hooks/dashboard-hook.sh";
    const first = patchClaudeSettings("{}", hookCommand);
    expect(first.changed).toBe(true);

    const second = patchClaudeSettings(first.value, hookCommand);
    expect(second.changed).toBe(false);
  });

  test("patches Codex config once", () => {
    const first = patchCodexConfig("model = \"gpt-5\"\n", "~/.codex/hooks/dashboard-hook.sh");
    expect(first.changed).toBe(true);
    expect(first.value.includes("notify = [\"~/.codex/hooks/dashboard-hook.sh\"]")).toBe(true);

    const second = patchCodexConfig(first.value, "~/.codex/hooks/dashboard-hook.sh");
    expect(second.changed).toBe(false);
  });
});
