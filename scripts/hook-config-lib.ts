export const SOURCE_MARKER = "agent-notify-dashboard";

export const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "TeammateIdle",
  "TaskCompleted",
  "InstructionsLoaded",
  "ConfigChange",
  "PreCompact",
  "Notification",
  "SessionEnd"
] as const;

export interface HookEditResult<T> {
  changed: boolean;
  value: T;
}

type ClaudeSettings = {
  hooks?: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

const hasManagedHook = (entry: Record<string, unknown>, commandContains: string): boolean => {
  if (entry._source === SOURCE_MARKER) return true;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return false;

  return hooks.some((hook) => {
    if (!hook || typeof hook !== "object") return false;
    const command = (hook as Record<string, unknown>).command;
    return typeof command === "string" && command.includes(commandContains);
  });
};

export const patchClaudeSettings = (
  rawContent: string,
  hookCommand: string
): HookEditResult<string> => {
  const parsed = rawContent.trim().length > 0
    ? (JSON.parse(rawContent) as ClaudeSettings)
    : {};

  const next: ClaudeSettings = parsed && typeof parsed === "object" ? { ...parsed } : {};
  next.hooks = next.hooks && typeof next.hooks === "object" ? { ...next.hooks } : {};

  let changed = false;

  for (const event of CLAUDE_EVENTS) {
    const eventHooks = Array.isArray(next.hooks[event]) ? [...next.hooks[event]] : [];
    const alreadyPresent = eventHooks.some((entry) => hasManagedHook(entry, "dashboard-hook.sh"));

    if (!alreadyPresent) {
      eventHooks.push({
        _source: SOURCE_MARKER,
        hooks: [
          {
            type: "command",
            command: hookCommand,
            async: true
          }
        ]
      });
      next.hooks[event] = eventHooks;
      changed = true;
    }
  }

  return {
    changed,
    value: `${JSON.stringify(next, null, 2)}\n`
  };
};

export const patchCodexConfig = (rawContent: string, hookPath: string): HookEditResult<string> => {
  const line = `notify = ["${hookPath}"]`;
  if (rawContent.includes("dashboard-hook.sh") || rawContent.includes(line)) {
    return { changed: false, value: rawContent };
  }

  const comment = `# [${SOURCE_MARKER}] Codex dashboard notify hook`;
  let next = rawContent;
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  next += `${comment}\n${line}\n`;

  return { changed: true, value: next };
};
