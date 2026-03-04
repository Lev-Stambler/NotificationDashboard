import { homedir } from "node:os";
import { join } from "node:path";
import type { DashboardSettings } from "./types";

const envNum = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const DEFAULT_CONFIG_DIR =
  process.env.DASH_CONFIG_DIR || join(homedir(), ".config", "agent-notify-dashboard");

export const DEFAULT_QUEUE_FILE =
  process.env.DASH_QUEUE_FILE || "/tmp/agent-dashboard/queue.jsonl";

export const CODEX_HISTORY_FILE = join(homedir(), ".codex", "history.jsonl");
export const CODEX_STATE_DB_FILE = join(homedir(), ".codex", "state_5.sqlite");
export const OPENCODE_DB_FILE = join(homedir(), ".local", "share", "opencode", "opencode.db");

export const NAMES_FILE = join(DEFAULT_CONFIG_DIR, "names.json");
export const CACHE_FILE = join(DEFAULT_CONFIG_DIR, "state-cache.json");
export const HIDDEN_FILE = join(DEFAULT_CONFIG_DIR, "hidden.json");

export const SETTINGS: DashboardSettings = {
  port: envNum("DASH_PORT", 3333),
  queueFile: DEFAULT_QUEUE_FILE,
  configDir: DEFAULT_CONFIG_DIR,
  recentTtlMinutes: envNum("DASH_RECENT_TTL_MINUTES", 30),
  staleDays: envNum("DASH_STALE_DAYS", 2),
  waitingToIdleMs: envNum("DASH_WAITING_TO_IDLE_MS", 120_000),
  workingToIdleMs: envNum("DASH_WORKING_TO_IDLE_MS", 180_000)
};

export const RECENT_TTL_MS = SETTINGS.recentTtlMinutes * 60_000;
export const STALE_SESSION_MS = SETTINGS.staleDays * 24 * 60 * 60 * 1_000;
