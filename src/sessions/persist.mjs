/**
 * Disk persistence for sessions/bindings (OpenClaw-inspired durable route map).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function defaultSessionsPath() {
  return path.join(os.homedir(), ".xclaw", "sessions.json");
}

export function loadSessionState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { sessions: [], bindings: {} };
  }
}

export function saveSessionState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath);
}
