export type AgentStatus = "idling" | "waiting" | "working";
export type AgentSource = "claude" | "codex" | "opencode";

export interface HookPayload {
  source?: string;
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  hook_sent_at?: number;
  claude_pid?: number;
  type?: string;
  codex_event?: string;
  "thread-id"?: string;
  [key: string]: unknown;
}

export interface AgentSession {
  agentKey: string;
  source: AgentSource;
  sessionId: string | null;
  projectPath: string;
  defaultName: string;
  customName: string | null;
  hidden: boolean;
  status: AgentStatus;
  lastEvent: string;
  lastActivityAt: number;
  pid: number | null;
  endedAt: number | null;
  lastTurnCompleteAt: number | null;
}

export interface DashboardSnapshot {
  sessions: AgentSession[];
  hiddenSessions: AgentSession[];
  generatedAt: number;
}

export interface DashboardSettings {
  port: number;
  queueFile: string;
  configDir: string;
  recentTtlMinutes: number;
  staleDays: number;
  waitingToIdleMs: number;
  workingToIdleMs: number;
}

export type WsMessage =
  | { type: "snapshot"; payload: DashboardSnapshot }
  | { type: "session_upsert"; payload: AgentSession }
  | { type: "session_remove"; payload: { agentKey: string } };

export interface CodexHistoryEntry {
  session_id?: string;
  ts?: number;
  text?: string;
}
