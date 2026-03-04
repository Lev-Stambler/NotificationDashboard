import { RECENT_TTL_MS, SETTINGS, STALE_SESSION_MS } from "./config";
import {
  buildAgentKey,
  defaultNameFromPath,
  detectSource,
  eventToStatus,
  normalizePath,
  resolveSessionId
} from "./status-mapper";
import type {
  AgentSession,
  AgentSource,
  AgentStatus,
  CodexHistoryEntry,
  HookPayload
} from "./types";

interface TickResult {
  updated: AgentSession[];
  removed: string[];
}

export class DashboardState {
  private readonly names: Map<string, string>;
  private readonly hidden: Set<string>;
  private readonly sessions: Map<string, AgentSession>;
  private readonly sessionToAgent: Map<string, string>;

  constructor(
    initialNames: Record<string, string>,
    initialRecent: AgentSession[],
    initialHidden: Record<string, boolean> = {}
  ) {
    this.names = new Map(Object.entries(initialNames));
    this.hidden = new Set(Object.entries(initialHidden).filter(([, value]) => value).map(([key]) => key));
    this.sessions = new Map();
    this.sessionToAgent = new Map();

    for (const session of initialRecent) {
      const isHidden = this.hidden.has(session.agentKey) || session.hidden === true;
      if (isHidden) {
        this.hidden.add(session.agentKey);
      }

      this.sessions.set(session.agentKey, {
        ...session,
        hidden: isHidden,
        customName: this.names.get(session.agentKey) ?? session.customName ?? null
      });
      if (session.sessionId) {
        this.sessionToAgent.set(`${session.source}:${session.sessionId}`, session.agentKey);
      }
    }
  }

  namesRecord(): Record<string, string> {
    return Object.fromEntries(this.names.entries());
  }

  hiddenRecord(): Record<string, boolean> {
    return Object.fromEntries([...this.hidden.values()].map((key) => [key, true]));
  }

  recentSessions(): AgentSession[] {
    return [...this.sessions.values()].filter((s) => s.endedAt !== null);
  }

  private isDisplayable(session: AgentSession, now: number): boolean {
    if (now - session.lastActivityAt > STALE_SESSION_MS) return false;
    if (session.endedAt === null) return true;
    return now - session.endedAt <= RECENT_TTL_MS;
  }

  visibleSessions(now = Date.now()): AgentSession[] {
    return [...this.sessions.values()]
      .filter((session) => this.isDisplayable(session, now) && !session.hidden)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  hiddenSessions(now = Date.now()): AgentSession[] {
    return [...this.sessions.values()]
      .filter((session) => this.isDisplayable(session, now) && session.hidden)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  rename(agentKey: string, name: string | null): AgentSession | null {
    const session = this.sessions.get(agentKey);
    if (!session) return null;

    const nextName = name && name.trim().length > 0 ? name.trim() : null;
    session.customName = nextName;

    if (nextName) this.names.set(agentKey, nextName);
    else this.names.delete(agentKey);

    this.sessions.set(agentKey, { ...session });
    return { ...session };
  }

  hide(agentKey: string): AgentSession | null {
    const session = this.sessions.get(agentKey);
    if (!session) return null;

    session.hidden = true;
    this.hidden.add(agentKey);
    this.sessions.set(agentKey, { ...session });
    return { ...session };
  }

  unhide(agentKey: string): AgentSession | null {
    const session = this.sessions.get(agentKey);
    if (!session) return null;

    session.hidden = false;
    this.hidden.delete(agentKey);
    this.sessions.set(agentKey, { ...session });
    return { ...session };
  }

  applyHook(payload: HookPayload, now = Date.now()): AgentSession | null {
    const source = detectSource(payload);
    const sessionId = resolveSessionId(payload);
    const hookEventName =
      typeof payload.hook_event_name === "string"
        ? payload.hook_event_name
        : typeof payload.type === "string"
          ? payload.type
          : "unknown";

    const existingBySession = sessionId
      ? this.sessions.get(this.sessionToAgent.get(`${source}:${sessionId}`) || "")
      : null;

    const incomingPath = typeof payload.cwd === "string" ? normalizePath(payload.cwd) : null;
    const projectPath = incomingPath || existingBySession?.projectPath || "unknown";
    const agentKey = buildAgentKey(source, projectPath);

    const defaultName = defaultNameFromPath(projectPath);
    const existing = this.sessions.get(agentKey);

    const base: AgentSession = existing
      ? { ...existing }
      : {
          agentKey,
          source,
          sessionId: null,
          projectPath,
          defaultName,
          customName: this.names.get(agentKey) ?? null,
          hidden: this.hidden.has(agentKey),
          status: "idling",
          lastEvent: "initialized",
          lastActivityAt: now,
          pid: null,
          endedAt: null,
          lastTurnCompleteAt: null
        };

    if (sessionId) {
      if (base.sessionId && base.sessionId !== sessionId) {
        this.sessionToAgent.delete(`${source}:${base.sessionId}`);
      }
      base.sessionId = sessionId;
      this.sessionToAgent.set(`${source}:${sessionId}`, agentKey);
    }

    if (typeof payload.claude_pid === "number" && Number.isFinite(payload.claude_pid)) {
      base.pid = payload.claude_pid;
    }

    const mapped = eventToStatus(source, hookEventName, now, base.status);
    base.status = mapped.status;
    base.lastEvent = hookEventName;
    base.lastActivityAt = now;

    if (mapped.endedAt !== null) {
      base.endedAt = mapped.endedAt;
    } else if (base.endedAt !== null && hookEventName !== "SessionEnd") {
      base.endedAt = null;
    }

    if (base.hidden) {
      base.hidden = false;
      this.hidden.delete(agentKey);
    }

    if (source === "codex" && (hookEventName === "agent-turn-complete" || hookEventName === "Stop")) {
      base.lastTurnCompleteAt = now;
    }

    this.sessions.set(agentKey, base);
    return { ...base };
  }

  applyCodexHistory(entry: CodexHistoryEntry): AgentSession | null {
    if (!entry.session_id) return null;
    const key = this.sessionToAgent.get(`codex:${entry.session_id}`);
    if (!key) return null;

    const session = this.sessions.get(key);
    if (!session) return null;

    session.status = "working";
    session.lastEvent = "history_prompt";
    session.lastActivityAt = entry.ts ? entry.ts * 1000 : Date.now();
    session.endedAt = null;
    if (session.hidden) {
      session.hidden = false;
      this.hidden.delete(session.agentKey);
    }

    this.sessions.set(session.agentKey, { ...session });
    return { ...session };
  }

  private applyExternalActivity(input: {
    source: AgentSource;
    sessionId: string;
    cwd: string | null;
    status: AgentStatus;
    lastEvent: string;
    updatedAtMs: number;
  }): AgentSession | null {
    if (!input.sessionId) return null;

    const existingBySession = this.sessions.get(
      this.sessionToAgent.get(`${input.source}:${input.sessionId}`) || ""
    );
    const incomingPath = input.cwd ? normalizePath(input.cwd) : null;
    const projectPath = incomingPath || existingBySession?.projectPath || "unknown";
    const agentKey = buildAgentKey(input.source, projectPath);
    const existing = this.sessions.get(agentKey);

    const base: AgentSession = existing
      ? { ...existing }
      : {
          agentKey,
          source: input.source,
          sessionId: null,
          projectPath,
          defaultName: defaultNameFromPath(projectPath),
          customName: this.names.get(agentKey) ?? null,
          hidden: this.hidden.has(agentKey),
          status: "idling",
          lastEvent: "initialized",
          lastActivityAt: input.updatedAtMs,
          pid: null,
          endedAt: null,
          lastTurnCompleteAt: null
        };

    if (base.sessionId && base.sessionId !== input.sessionId) {
      this.sessionToAgent.delete(`${input.source}:${base.sessionId}`);
    }

    base.sessionId = input.sessionId;
    base.status = input.status;
    base.lastEvent = input.lastEvent;
    base.lastActivityAt = input.updatedAtMs;
    base.endedAt = input.status === "idling" ? base.endedAt : null;
    if (base.hidden) {
      base.hidden = false;
      this.hidden.delete(agentKey);
    }
    if (input.source === "codex" && input.status === "waiting") {
      base.lastTurnCompleteAt = input.updatedAtMs;
    }

    this.sessionToAgent.set(`${input.source}:${input.sessionId}`, agentKey);
    this.sessions.set(agentKey, base);
    return { ...base };
  }

  applyCodexThreadActivity(input: {
    threadId: string;
    cwd: string | null;
    updatedAtMs: number;
  }): AgentSession | null {
    return this.applyExternalActivity({
      source: "codex",
      sessionId: input.threadId,
      cwd: input.cwd,
      status: "working",
      lastEvent: "thread_activity",
      updatedAtMs: input.updatedAtMs
    });
  }

  applyOpenCodeActivity(input: {
    sessionId: string;
    cwd: string | null;
    status: AgentStatus;
    lastEvent: string;
    updatedAtMs: number;
  }): AgentSession | null {
    return this.applyExternalActivity({
      source: "opencode",
      sessionId: input.sessionId,
      cwd: input.cwd,
      status: input.status,
      lastEvent: input.lastEvent,
      updatedAtMs: input.updatedAtMs
    });
  }

  tick(now = Date.now()): TickResult {
    const updated: AgentSession[] = [];
    const removed: string[] = [];

    for (const [agentKey, session] of this.sessions.entries()) {
      let dirty = false;

      if (now - session.lastActivityAt > STALE_SESSION_MS) {
        this.sessions.delete(agentKey);
        this.hidden.delete(agentKey);
        if (session.sessionId) {
          this.sessionToAgent.delete(`${session.source}:${session.sessionId}`);
        }
        removed.push(agentKey);
        continue;
      }

      if (session.endedAt !== null) {
        if (now - session.endedAt > RECENT_TTL_MS) {
          this.sessions.delete(agentKey);
          this.hidden.delete(agentKey);
          if (session.sessionId) {
            this.sessionToAgent.delete(`${session.source}:${session.sessionId}`);
          }
          removed.push(agentKey);
          continue;
        }
      }

      if (session.pid && session.source === "codex") {
        try {
          process.kill(session.pid, 0);
        } catch {
          session.pid = null;
          session.endedAt = session.endedAt ?? now;
          session.status = "idling";
          session.lastEvent = "pid_dead";
          session.lastActivityAt = now;
          dirty = true;
        }
      }

      const elapsed = now - session.lastActivityAt;

      if (session.status === "waiting" && elapsed > SETTINGS.waitingToIdleMs) {
        session.status = "idling";
        session.lastEvent = "waiting_timeout";
        dirty = true;
      }

      if (session.status === "working" && elapsed > SETTINGS.workingToIdleMs) {
        session.status = "idling";
        session.lastEvent = "working_timeout";
        dirty = true;
      }

      if (dirty) {
        this.sessions.set(agentKey, { ...session });
        updated.push({ ...session });
      }
    }

    return { updated, removed };
  }
}

export const statusLabel = (status: AgentStatus): string => {
  if (status === "working") return "Working";
  if (status === "waiting") return "Waiting for answer";
  return "Idling";
};

export const sourceLabel = (source: AgentSource): string => {
  if (source === "codex") return "Codex";
  if (source === "opencode") return "OpenCode";
  return "Claude";
};
