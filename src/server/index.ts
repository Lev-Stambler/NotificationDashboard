import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  CACHE_FILE,
  CODEX_HISTORY_FILE,
  CODEX_STATE_DB_FILE,
  NAMES_FILE,
  OPENCODE_DB_FILE,
  SETTINGS
} from "./config";
import { loadNames, loadRecent, saveNames, saveRecent } from "./persistence";
import { DashboardState } from "./state";
import type { AgentStatus, CodexHistoryEntry, HookPayload, WsMessage } from "./types";

const app = new Hono();

const names = await loadNames(NAMES_FILE);
const recent = await loadRecent(CACHE_FILE);
const stateStore = new DashboardState(names, recent);

const sockets = new Set<Bun.ServerWebSocket<unknown>>();

const send = (message: WsMessage): void => {
  const encoded = JSON.stringify(message);
  for (const socket of sockets) {
    socket.send(encoded);
  }
};

const upsertSession = (payload: HookPayload, now?: number): void => {
  const session = stateStore.applyHook(payload, now);
  if (!session) return;

  send({ type: "session_upsert", payload: session });
};

const persistAll = async (): Promise<void> => {
  await saveNames(NAMES_FILE, stateStore.namesRecord());
  await saveRecent(CACHE_FILE, stateStore.recentSessions());
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const queuePersist = (): void => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistAll();
  }, 250);
};

const safeJson = (input: string): unknown => {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

interface CodexThreadRow {
  id: string;
  cwd: string;
  updated_at: number;
}

interface OpenCodeSessionRow {
  id: string;
  directory: string;
  time_updated: number;
  latest_data: string | null;
}

const numberOrNull = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const resolveOpenCodeActivity = (row: OpenCodeSessionRow): {
  status: AgentStatus;
  lastEvent: string;
  updatedAtMs: number;
  cwd: string | null;
} => {
  let status: AgentStatus = "idling";
  let lastEvent = "session_activity";
  let updatedAtMs = row.time_updated;
  let cwd: string | null = row.directory || null;

  if (!row.latest_data) {
    return { status, lastEvent, updatedAtMs, cwd };
  }

  const parsed = safeJson(row.latest_data);
  if (!parsed || typeof parsed !== "object") {
    return { status, lastEvent, updatedAtMs, cwd };
  }

  const payload = parsed as Record<string, unknown>;
  const role = typeof payload.role === "string" ? payload.role : null;

  const path = payload.path;
  if (path && typeof path === "object") {
    const candidate = (path as Record<string, unknown>).cwd;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      cwd = candidate;
    }
  }

  const time = payload.time;
  if (time && typeof time === "object") {
    const timeRecord = time as Record<string, unknown>;
    const created = numberOrNull(timeRecord.created);
    const completed = numberOrNull(timeRecord.completed);

    if (created !== null && created > updatedAtMs) updatedAtMs = created;
    if (completed !== null && completed > updatedAtMs) updatedAtMs = completed;

    if (role === "assistant") {
      if (completed === null) {
        status = "working";
        lastEvent = "assistant_in_progress";
      } else {
        status = "waiting";
        lastEvent = "assistant_complete";
      }
    } else if (role === "user") {
      status = "working";
      lastEvent = "user_message";
    }
  }

  return { status, lastEvent, updatedAtMs, cwd };
};

await mkdir(SETTINGS.configDir, { recursive: true });
await mkdir(dirname(SETTINGS.queueFile), { recursive: true });
if (!(await Bun.file(SETTINGS.queueFile).exists())) {
  await Bun.write(SETTINGS.queueFile, "");
}

let queueOffset = 0;
let queueRemainder = "";

const bootQueue = async (): Promise<void> => {
  try {
    const info = await stat(SETTINGS.queueFile);
    queueOffset = info.size;
  } catch {
    queueOffset = 0;
  }
};

const readQueue = async (): Promise<void> => {
  let info;
  try {
    info = await stat(SETTINGS.queueFile);
  } catch {
    return;
  }

  if (info.size <= queueOffset) return;

  const handle = await open(SETTINGS.queueFile, "r");
  try {
    const len = info.size - queueOffset;
    const buffer = Buffer.alloc(len);
    const { bytesRead } = await handle.read(buffer, 0, len, queueOffset);
    queueOffset += bytesRead;

    const chunk = queueRemainder + buffer.subarray(0, bytesRead).toString("utf8");
    const lines = chunk.split("\n");
    queueRemainder = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = safeJson(trimmed);
      if (!parsed || typeof parsed !== "object") continue;
      upsertSession(parsed as HookPayload);
    }

    queuePersist();
  } finally {
    await handle.close();
  }
};

let historyOffset = 0;
let historyRemainder = "";
let codexDb: Database | null = null;
let codexThreadUpdatedAt = 0;
let openCodeDb: Database | null = null;
let openCodeSessionUpdatedAt = 0;

const bootHistory = async (): Promise<void> => {
  try {
    const info = await stat(CODEX_HISTORY_FILE);
    historyOffset = info.size;
  } catch {
    historyOffset = 0;
  }
};

const readHistory = async (): Promise<void> => {
  let info;
  try {
    info = await stat(CODEX_HISTORY_FILE);
  } catch {
    return;
  }

  if (info.size <= historyOffset) return;

  const handle = await open(CODEX_HISTORY_FILE, "r");
  try {
    const len = info.size - historyOffset;
    const buffer = Buffer.alloc(len);
    const { bytesRead } = await handle.read(buffer, 0, len, historyOffset);
    historyOffset += bytesRead;

    const chunk = historyRemainder + buffer.subarray(0, bytesRead).toString("utf8");
    const lines = chunk.split("\n");
    historyRemainder = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = safeJson(trimmed);
      if (!parsed || typeof parsed !== "object") continue;
      const entry = parsed as CodexHistoryEntry;
      const updated = stateStore.applyCodexHistory(entry);
      if (updated) {
        send({ type: "session_upsert", payload: updated });
      }
    }
  } finally {
    await handle.close();
  }
};

const openReadonlyDatabase = async (path: string): Promise<Database | null> => {
  if (!(await Bun.file(path).exists())) return null;
  try {
    return new Database(path, { readonly: true });
  } catch {
    return null;
  }
};

const bootCodexThreads = async (): Promise<void> => {
  codexDb = await openReadonlyDatabase(CODEX_STATE_DB_FILE);
  if (!codexDb) return;

  const rows = codexDb
    .query(
      "SELECT id, cwd, updated_at FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 150"
    )
    .all() as CodexThreadRow[];

  for (const row of [...rows].reverse()) {
    const updated = stateStore.applyCodexThreadActivity({
      threadId: row.id,
      cwd: row.cwd,
      updatedAtMs: row.updated_at * 1000
    });
    if (updated) {
      send({ type: "session_upsert", payload: updated });
    }
    if (row.updated_at > codexThreadUpdatedAt) {
      codexThreadUpdatedAt = row.updated_at;
    }
  }
};

const readCodexThreads = async (): Promise<void> => {
  if (!codexDb) {
    codexDb = await openReadonlyDatabase(CODEX_STATE_DB_FILE);
    if (!codexDb) return;
  }

  const rows = codexDb
    .query(
      "SELECT id, cwd, updated_at FROM threads WHERE archived = 0 AND updated_at > ? ORDER BY updated_at ASC LIMIT 300"
    )
    .all(codexThreadUpdatedAt) as CodexThreadRow[];

  let changed = false;

  for (const row of rows) {
    const updated = stateStore.applyCodexThreadActivity({
      threadId: row.id,
      cwd: row.cwd,
      updatedAtMs: row.updated_at * 1000
    });
    if (updated) {
      changed = true;
      send({ type: "session_upsert", payload: updated });
    }
    if (row.updated_at > codexThreadUpdatedAt) {
      codexThreadUpdatedAt = row.updated_at;
    }
  }

  if (changed) {
    queuePersist();
  }
};

const bootOpenCodeSessions = async (): Promise<void> => {
  openCodeDb = await openReadonlyDatabase(OPENCODE_DB_FILE);
  if (!openCodeDb) return;

  const rows = openCodeDb
    .query(
      `SELECT
        s.id,
        s.directory,
        s.time_updated,
        (
          SELECT m.data
          FROM message m
          WHERE m.session_id = s.id
          ORDER BY m.time_created DESC
          LIMIT 1
        ) AS latest_data
      FROM session s
      WHERE s.time_archived IS NULL
      ORDER BY s.time_updated DESC
      LIMIT 150`
    )
    .all() as OpenCodeSessionRow[];

  for (const row of [...rows].reverse()) {
    const activity = resolveOpenCodeActivity(row);
    const updated = stateStore.applyOpenCodeActivity({
      sessionId: row.id,
      cwd: activity.cwd,
      status: activity.status,
      lastEvent: activity.lastEvent,
      updatedAtMs: activity.updatedAtMs
    });
    if (updated) {
      send({ type: "session_upsert", payload: updated });
    }
    if (row.time_updated > openCodeSessionUpdatedAt) {
      openCodeSessionUpdatedAt = row.time_updated;
    }
  }
};

const readOpenCodeSessions = async (): Promise<void> => {
  if (!openCodeDb) {
    openCodeDb = await openReadonlyDatabase(OPENCODE_DB_FILE);
    if (!openCodeDb) return;
  }

  const rows = openCodeDb
    .query(
      `SELECT
        s.id,
        s.directory,
        s.time_updated,
        (
          SELECT m.data
          FROM message m
          WHERE m.session_id = s.id
          ORDER BY m.time_created DESC
          LIMIT 1
        ) AS latest_data
      FROM session s
      WHERE s.time_archived IS NULL
        AND s.time_updated > ?
      ORDER BY s.time_updated ASC
      LIMIT 300`
    )
    .all(openCodeSessionUpdatedAt) as OpenCodeSessionRow[];

  let changed = false;

  for (const row of rows) {
    const activity = resolveOpenCodeActivity(row);
    const updated = stateStore.applyOpenCodeActivity({
      sessionId: row.id,
      cwd: activity.cwd,
      status: activity.status,
      lastEvent: activity.lastEvent,
      updatedAtMs: activity.updatedAtMs
    });
    if (updated) {
      changed = true;
      send({ type: "session_upsert", payload: updated });
    }
    if (row.time_updated > openCodeSessionUpdatedAt) {
      openCodeSessionUpdatedAt = row.time_updated;
    }
  }

  if (changed) {
    queuePersist();
  }
};

const contentType = (path: string): string => {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
};

const serveFile = async (path: string): Promise<Response> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(file, {
    headers: {
      "Content-Type": contentType(path),
      "Cache-Control": "no-store"
    }
  });
};

app.get("/api/sessions", (c) => {
  return c.json({ sessions: stateStore.visibleSessions() });
});

app.get("/api/settings", (c) => {
  return c.json(SETTINGS);
});

app.patch("/api/agents/:agentKey/name", async (c) => {
  const agentKey = c.req.param("agentKey");
  const body = await c.req.json<{ name?: string | null }>();
  const updated = stateStore.rename(agentKey, body.name ?? null);
  if (!updated) return c.json({ error: "Agent not found" }, 404);

  send({ type: "session_upsert", payload: updated });
  queuePersist();
  return c.json({ session: updated });
});

app.post("/api/hooks", async (c) => {
  const body = await c.req.json<HookPayload>();
  upsertSession(body);
  queuePersist();
  return c.json({ ok: true });
});

app.get("/api/health", (c) => {
  return c.json({ ok: true, timestamp: Date.now() });
});

app.get("/styles.css", async () => {
  return serveFile("public/styles.css");
});

app.get("/assets/*", async (c) => {
  const path = c.req.path.replace(/^\//, "public/");
  return serveFile(path);
});

app.get("/", async () => {
  return serveFile("public/index.html");
});

await bootQueue();
await bootHistory();
await bootCodexThreads();
await bootOpenCodeSessions();

setInterval(() => {
  void readQueue();
}, 250);

setInterval(() => {
  void readHistory();
}, 750);

setInterval(() => {
  void readCodexThreads();
}, 1_000);

setInterval(() => {
  void readOpenCodeSessions();
}, 1_000);

setInterval(() => {
  const result = stateStore.tick();
  for (const updated of result.updated) {
    send({ type: "session_upsert", payload: updated });
  }
  for (const removed of result.removed) {
    send({ type: "session_remove", payload: { agentKey: removed } });
  }
  if (result.updated.length > 0 || result.removed.length > 0) {
    queuePersist();
  }
}, 5_000);

const server = Bun.serve({
  port: SETTINGS.port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (srv.upgrade(req)) {
        return new Response(null);
      }
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      ws.send(
        JSON.stringify({
          type: "snapshot",
          payload: {
            sessions: stateStore.visibleSessions(),
            generatedAt: Date.now()
          }
        } satisfies WsMessage)
      );
    },
    close(ws) {
      sockets.delete(ws);
    },
    message() {
      // No inbound WS messages are needed for this dashboard.
    }
  }
});

console.log(`agent-notify-dashboard listening on http://localhost:${server.port}`);

const shutdown = async (): Promise<void> => {
  await persistAll();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
