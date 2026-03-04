import { useEffect, useMemo, useState } from "react";
import { AgentCard } from "./components/AgentCard";
import { RenameModal } from "./components/RenameModal";
import type { AgentSession, WsMessage } from "./types";

const mergeSession = (sessions: AgentSession[], incoming: AgentSession): AgentSession[] => {
  const next = new Map(sessions.map((session) => [session.agentKey, session]));
  next.set(incoming.agentKey, incoming);
  return [...next.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
};

const countByStatus = (sessions: AgentSession[]) => {
  return sessions.reduce(
    (acc, session) => {
      acc[session.status] += 1;
      return acc;
    },
    { idling: 0, waiting: 0, working: 0 }
  );
};

export default function App() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selected, setSelected] = useState<AgentSession | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchInitial = async () => {
      const response = await fetch("/api/sessions");
      const payload = (await response.json()) as { sessions: AgentSession[] };
      if (!cancelled) {
        setSessions(payload.sessions);
      }
    };

    void fetchInitial();

    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as WsMessage;
      if (message.type === "snapshot") {
        setSessions(message.payload.sessions);
        return;
      }
      if (message.type === "session_upsert") {
        setSessions((previous) => mergeSession(previous, message.payload));
        return;
      }
      if (message.type === "session_remove") {
        setSessions((previous) => previous.filter((session) => session.agentKey !== message.payload.agentKey));
      }
    };

    return () => {
      cancelled = true;
      socket.close();
    };
  }, []);

  const counts = useMemo(() => countByStatus(sessions), [sessions]);

  const saveName = async (session: AgentSession, name: string | null): Promise<void> => {
    const response = await fetch(`/api/agents/${encodeURIComponent(session.agentKey)}/name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      throw new Error("Failed to save name");
    }

    const payload = (await response.json()) as { session: AgentSession };
    setSessions((previous) => mergeSession(previous, payload.session));
  };

  return (
    <main className="dashboard-shell">
      <section className="hero">
        <h1>Agent Control Room</h1>
        <p>Live status board for Claude, Codex, and OpenCode workspaces.</p>
        <div className="connection-pill">{connected ? "Live feed connected" : "Reconnecting feed"}</div>
      </section>

      <section className="summary-grid">
        <article>
          <h2>Working</h2>
          <p>{counts.working}</p>
        </article>
        <article>
          <h2>Waiting</h2>
          <p>{counts.waiting}</p>
        </article>
        <article>
          <h2>Idling</h2>
          <p>{counts.idling}</p>
        </article>
      </section>

      <section className="cards-grid">
        {sessions.map((session) => (
          <AgentCard key={session.agentKey} session={session} onRename={setSelected} />
        ))}
      </section>

      <RenameModal session={selected} onClose={() => setSelected(null)} onSave={saveName} />
    </main>
  );
}
