export type AgentStatus = "idling" | "waiting" | "background" | "working";
export type AgentSource = "claude" | "codex" | "opencode";

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
  sortActivityAt: number;
  pid: number | null;
  endedAt: number | null;
  lastTurnCompleteAt: number | null;
}

export interface WsMessageSnapshot {
  type: "snapshot";
  payload: {
    sessions: AgentSession[];
    hiddenSessions: AgentSession[];
    generatedAt: number;
  };
}

export interface WsMessageUpsert {
  type: "session_upsert";
  payload: AgentSession;
}

export interface WsMessageRemove {
  type: "session_remove";
  payload: { agentKey: string };
}

export type WsMessage = WsMessageSnapshot | WsMessageUpsert | WsMessageRemove;
