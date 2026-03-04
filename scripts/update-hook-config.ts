import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CLAUDE_EVENTS, patchClaudeSettings, patchCodexConfig } from "./hook-config-lib";

const args = process.argv.slice(2);

const readFlag = (flag: string): boolean => args.includes(flag);
const readValue = (flag: string): string | null => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};
const readValues = (flag: string): string[] => {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) {
      values.push(args[i + 1]);
      i += 1;
    }
  }
  return values;
};

const dryRun = readFlag("--dry-run");
const verbose = readFlag("--verbose");

const codexConfig = readValue("--codex-config");
const codexHookPath = readValue("--codex-hook-path");
const claudeHookCommand = readValue("--claude-hook-command");
const claudeSettingsPaths = readValues("--claude-settings");

if (!codexConfig || !codexHookPath || !claudeHookCommand) {
  console.error("Missing required arguments for update-hook-config.ts");
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[.:]/g, "-");

const backupFile = async (path: string): Promise<void> => {
  try {
    await mkdir(dirname(path), { recursive: true });
    await copyFile(path, `${path}.bak.${timestamp}`);
  } catch {
    // If the file does not exist yet, no backup is needed.
  }
};

const readMaybe = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
};

let changedCount = 0;

for (const settingsPath of claudeSettingsPaths) {
  const current = await readMaybe(settingsPath);
  const patched = patchClaudeSettings(current, claudeHookCommand);

  if (patched.changed) {
    changedCount += 1;
    if (dryRun) {
      console.log(`[dry-run] Would update Claude settings: ${settingsPath}`);
    } else {
      await backupFile(settingsPath);
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, patched.value, "utf8");
      console.log(`Updated Claude settings: ${settingsPath}`);
    }
  } else if (verbose) {
    console.log(`Claude settings already configured: ${settingsPath}`);
  }
}

const codexCurrent = await readMaybe(codexConfig);
const codexPatched = patchCodexConfig(codexCurrent, codexHookPath);
if (codexPatched.changed) {
  changedCount += 1;
  if (dryRun) {
    console.log(`[dry-run] Would update Codex config: ${codexConfig}`);
  } else {
    await backupFile(codexConfig);
    await mkdir(dirname(codexConfig), { recursive: true });
    await writeFile(codexConfig, codexPatched.value, "utf8");
    console.log(`Updated Codex config: ${codexConfig}`);
  }
} else if (verbose) {
  console.log(`Codex config already configured: ${codexConfig}`);
}

if (verbose) {
  console.log(`Managed Claude events: ${CLAUDE_EVENTS.join(", ")}`);
}

console.log(changedCount > 0 ? "Hook configuration complete." : "No configuration changes needed.");
