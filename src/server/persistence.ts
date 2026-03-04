import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentSession } from "./types";

export interface PersistedData {
  names: Record<string, string>;
  recent: AgentSession[];
}

const safeParse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const atomicWrite = async (filePath: string, content: string): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
  await unlink(tempPath).catch(() => {});
};

export const loadNames = async (filePath: string): Promise<Record<string, string>> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = safeParse<Record<string, string>>(raw, {});
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const saveNames = async (filePath: string, names: Record<string, string>): Promise<void> => {
  await atomicWrite(filePath, `${JSON.stringify(names, null, 2)}\n`);
};

export const loadHidden = async (filePath: string): Promise<Record<string, boolean>> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = safeParse<Record<string, boolean>>(raw, {});
    if (!parsed || typeof parsed !== "object") return {};

    const next: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true) {
        next[key] = true;
      }
    }
    return next;
  } catch {
    return {};
  }
};

export const saveHidden = async (filePath: string, hidden: Record<string, boolean>): Promise<void> => {
  await atomicWrite(filePath, `${JSON.stringify(hidden, null, 2)}\n`);
};

export const loadRecent = async (filePath: string): Promise<AgentSession[]> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = safeParse<AgentSession[]>(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveRecent = async (filePath: string, sessions: AgentSession[]): Promise<void> => {
  await atomicWrite(filePath, `${JSON.stringify(sessions, null, 2)}\n`);
};
