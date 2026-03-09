import type { AgentSession } from "../types";

const statusLabel = (status: AgentSession["status"]): string => {
  if (status === "working") return "Working";
  if (status === "background") return "Background + Working";
  if (status === "waiting") return "Waiting for answer";
  return "Idling";
};

const sourceLabel = (source: AgentSession["source"]): string => {
  if (source === "codex") return "Codex";
  if (source === "opencode") return "OpenCode";
  return "Claude";
};

const relativeTime = (timestamp: number): string => {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

interface Props {
  session: AgentSession;
  onRename: (session: AgentSession) => void;
  onHide: (session: AgentSession) => void;
}

export function AgentCard({ session, onRename, onHide }: Props) {
  const displayName = session.customName || session.defaultName;

  return (
    <article className={`agent-card status-${session.status}`}>
      <header className="agent-head">
        <div className="status-light" aria-hidden="true" />
        <div>
          <h3>{displayName}</h3>
          <p>{session.projectPath}</p>
        </div>
      </header>

      <div className="badges">
        <span className="badge source">{sourceLabel(session.source)}</span>
        <span className={`badge status status-${session.status}`}>{statusLabel(session.status)}</span>
      </div>

      <dl className="meta">
        <div>
          <dt>Last event</dt>
          <dd>{session.lastEvent}</dd>
        </div>
        <div>
          <dt>Activity</dt>
          <dd>{relativeTime(session.lastActivityAt)}</dd>
        </div>
      </dl>

      <div className="card-actions">
        <button type="button" className="rename-button" onClick={() => onRename(session)}>
          Rename
        </button>
        <button type="button" className="hide-button" onClick={() => onHide(session)}>
          Hide
        </button>
      </div>
    </article>
  );
}
