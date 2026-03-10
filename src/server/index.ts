import { mkdir, open, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  resolveLatestClaudeTranscriptActivity,
  resolveOpenCodeActivity,
  sessionIdFromTranscriptPath,
  type OpenCodeSessionRow
} from "./activity-resolver";
import {
  CACHE_FILE,
  CLAUDE_PROJECTS_DIR,
  CODEX_HISTORY_FILE,
  CODEX_STATE_DB_FILE,
  HIDDEN_FILE,
  NAMES_FILE,
  OPENCODE_DB_FILE,
  SETTINGS
} from "./config";
import { loadHidden, loadNames, loadRecent, saveHidden, saveNames, saveRecent } from "./persistence";
import { DashboardState } from "./state";
import type { AgentStatus, CodexHistoryEntry, HookPayload, WsMessage } from "./types";

const app = new Hono();

const names = await loadNames(NAMES_FILE);
const recent = await loadRecent(CACHE_FILE);
const hidden = await loadHidden(HIDDEN_FILE);
const stateStore = new DashboardState(names, recent, hidden);

const sockets = new Set<Bun.ServerWebSocket<unknown>>();

const send = (message: WsMessage): void => {
  const encoded = JSON.stringify(message);
  for (const socket of sockets) {
    socket.send(encoded);
  }
};

const claudeTranscriptPaths = new Map<string, string>();

const trackClaudeTranscriptPath = (payload: HookPayload): void => {
  if (payload.source !== "claude") return;
  if (typeof payload.session_id !== "string" || payload.session_id.length === 0) return;
  if (typeof payload.transcript_path !== "string" || payload.transcript_path.length === 0) return;

  claudeTranscriptPaths.set(payload.session_id, payload.transcript_path);
};

const upsertSession = (payload: HookPayload, now?: number): void => {
  trackClaudeTranscriptPath(payload);
  const session = stateStore.applyHook(payload, now);
  if (!session) return;

  send({ type: "session_upsert", payload: session });
};

const persistAll = async (): Promise<void> => {
  await saveNames(NAMES_FILE, stateStore.namesRecord());
  await saveRecent(CACHE_FILE, stateStore.recentSessions());
  await saveHidden(HIDDEN_FILE, stateStore.hiddenRecord());
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

await mkdir(SETTINGS.configDir, { recursive: true });
await mkdir(dirname(SETTINGS.queueFile), { recursive: true });
if (!(await Bun.file(SETTINGS.queueFile).exists())) {
  await Bun.write(SETTINGS.queueFile, "");
}

let queueOffset = 0;
let queueRemainder = "";

const bootQueue = async (): Promise<void> => {
  queueOffset = 0;
  queueRemainder = "";
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
const claudeTranscriptMtime = new Map<string, number>();

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

const readClaudeTranscriptTail = async (filePath: string): Promise<string[]> => {
  const info = await stat(filePath);
  const handle = await open(filePath, "r");
  try {
    const maxBytes = 128 * 1024;
    const start = Math.max(0, info.size - maxBytes);
    const length = info.size - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } finally {
    await handle.close();
  }
};

const listClaudeTranscriptFiles = async (): Promise<string[]> => {
  if (!(await Bun.file(CLAUDE_PROJECTS_DIR).exists())) return [];

  const projectEntries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  const files: string[] = [];

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectDir = join(CLAUDE_PROJECTS_DIR, projectEntry.name);
    const sessionEntries = await readdir(projectDir, { withFileTypes: true });
    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isFile() || !sessionEntry.name.endsWith(".jsonl")) continue;
      files.push(join(projectDir, sessionEntry.name));
    }
  }

  return files;
};

const ingestClaudeTranscript = async (filePath: string, force = false): Promise<boolean> => {
  const sessionId = sessionIdFromTranscriptPath(filePath);
  if (!sessionId) return false;
  let info;
  try {
    info = await stat(filePath);
  } catch {
    claudeTranscriptPaths.delete(sessionId);
    claudeTranscriptMtime.delete(sessionId);
    return false;
  }
  if (!force && (claudeTranscriptMtime.get(sessionId) ?? 0) >= info.mtimeMs) return false;

  claudeTranscriptPaths.set(sessionId, filePath);

  let lines: string[];
  try {
    lines = await readClaudeTranscriptTail(filePath);
  } catch {
    claudeTranscriptPaths.delete(sessionId);
    claudeTranscriptMtime.delete(sessionId);
    return false;
  }
  const activity = resolveLatestClaudeTranscriptActivity(lines, info.mtimeMs);
  claudeTranscriptMtime.set(sessionId, info.mtimeMs);

  if (!activity) {
    return false;
  }

  const updated = stateStore.applyClaudeTranscriptActivity(activity);
  if (updated) {
    send({ type: "session_upsert", payload: updated });
    return true;
  }

  return false;
};

const bootClaudeTranscripts = async (): Promise<void> => {
  const files = await listClaudeTranscriptFiles();
  const datedFiles = await Promise.all(
    files.map(async (filePath) => ({ filePath, updatedAtMs: (await stat(filePath)).mtimeMs }))
  );

  datedFiles.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  for (const file of datedFiles) {
    await ingestClaudeTranscript(file.filePath);
  }
};

const refreshTrackedClaudeTranscripts = async (force = false): Promise<void> => {
  const files = new Set<string>(claudeTranscriptPaths.values());
  if (files.size === 0) return;

  let changed = false;
  for (const filePath of files) {
    const ingested = await ingestClaudeTranscript(filePath, force);
    changed = changed || ingested;
  }
  if (changed) {
    queuePersist();
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
        ) AS latest_data,
        (
          SELECT p.data
          FROM part p
          WHERE p.session_id = s.id
          ORDER BY p.time_updated DESC, p.time_created DESC
          LIMIT 1
        ) AS latest_part_data
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
        ) AS latest_data,
        (
          SELECT p.data
          FROM part p
          WHERE p.session_id = s.id
          ORDER BY p.time_updated DESC, p.time_created DESC
          LIMIT 1
        ) AS latest_part_data
      FROM session s
      WHERE s.time_archived IS NULL
      ORDER BY s.time_updated DESC
      LIMIT 150`
    )
    .all() as OpenCodeSessionRow[];

  let changed = false;

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
      changed = true;
      send({ type: "session_upsert", payload: updated });
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

app.get("/api/sessions", async (c) => {
  await refreshTrackedClaudeTranscripts();
  return c.json({
    sessions: stateStore.visibleSessions(),
    hiddenSessions: stateStore.hiddenSessions()
  });
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

app.patch("/api/agents/:agentKey/hidden", async (c) => {
  const agentKey = c.req.param("agentKey");
  const body = await c.req.json<{ hidden?: boolean }>();
  const shouldHide = body.hidden === true;
  const updated = shouldHide ? stateStore.hide(agentKey) : stateStore.unhide(agentKey);
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

app.get("/api/debug/notifications", (c) => {
  return c.json({
    unknownClaudeNotifications: stateStore.unknownNotifications(),
    generatedAt: Date.now()
  });
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
await readQueue();
await bootHistory();
await bootClaudeTranscripts();
await refreshTrackedClaudeTranscripts(true);
await bootCodexThreads();
await bootOpenCodeSessions();

setInterval(() => {
  void readQueue();
}, 250);

setInterval(() => {
  void readHistory();
}, 750);

setInterval(() => {
  void refreshTrackedClaudeTranscripts();
}, 1_000);

setInterval(() => {
  void readCodexThreads();
}, 1_000);

setInterval(() => {
  void readOpenCodeSessions();
}, 1_000);

setInterval(() => {
  void (async () => {
    await refreshTrackedClaudeTranscripts();

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
  })();
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
      void (async () => {
        await refreshTrackedClaudeTranscripts();
        ws.send(
          JSON.stringify({
            type: "snapshot",
            payload: {
              sessions: stateStore.visibleSessions(),
              hiddenSessions: stateStore.hiddenSessions(),
              generatedAt: Date.now()
            }
          } satisfies WsMessage)
        );
      })();
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
