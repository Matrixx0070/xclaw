/**
 * P0 extraction status — reports MODULE_MAP + clean native modules.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listNativeTools } from "./native-tools.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function loadModuleMap() {
  const p = path.join(root, "src/computer/MODULE_MAP.json");
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

/**
 * @returns {Promise<object>}
 */
export async function getExtractionStatus() {
  const map = await loadModuleMap();
  const native = listNativeTools();
  const extracted = map.extracted || [];
  const cleanIds = new Set([
    "bash-tool",
    "file-read-tool",
    "file-write-tool",
    "file-edit-tool",
  ]);
  const nativeReady = native.map((t) => t.name);

  const referenceOnly = extracted.filter((e) => {
    // clean rewrite exists for core file/bash
    if (e.id === "bash-tool" || e.id.startsWith("file-")) return false;
    return true;
  });

  return {
    ok: true,
    bundle: {
      path: map.sourceBundle,
      bytes: map.sourceBytes,
      lines: map.sourceLines,
      vendoredLines: map.coverage?.vendoredLines,
      appLines: map.coverage?.appLines,
    },
    extractedReferenceModules: extracted.map((e) => ({
      id: e.id,
      path: e.path,
      bytes: e.bytes,
    })),
    cleanNativeTools: nativeReady,
    cleanModules: map.cleanModules || {},
    progress: {
      // Rough: vendored stays; app surface partially extracted
      appLinesMapped: map.coverage?.appLines ?? null,
      referenceExtractions: extracted.length,
      cleanStandaloneTools: nativeReady.length,
      note:
        "Vendored ~380k lines remain in bundle. Clean standalone: bash + file read/write/edit. Next: wire native tools into computer HTTP or agent local path; extract browser_tab to clean module.",
    },
    nextSlices: [
      "browser-tab-tool → clean CDP module (prefer browser-service.mjs)",
      "http-server-main → thin router importing native tools",
      "CI gate: fail if new tool only added inside xclaw-server.mjs",
    ],
  };
}

export async function printExtractionStatus() {
  const s = await getExtractionStatus();
  console.log(JSON.stringify(s, null, 2));
  return s;
}

export default { getExtractionStatus, loadModuleMap, printExtractionStatus };
