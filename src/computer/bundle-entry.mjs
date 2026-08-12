/**
 * Strategy C2/C3 — future esbuild entry for xclaw-server.mjs.
 *
 * C2: documents the import graph for maintained tools.
 * C3: esbuild will bundle this (+ vendor/CDP) into xclaw-server.mjs.
 *
 * DO NOT use this as the live computer process yet — use thin-server
 * (lab) or the existing xclaw-server.mjs artifact (full runtime).
 */

export {
  MAINTAINED_TOOLS,
  listMaintainedTools,
  executeMaintainedTool,
  BUNDLE_ONLY_REGIONS,
} from "./modules/registry.mjs";

export const BUNDLE_ENTRY_META = {
  strategy: "C",
  phase: "C2",
  role: "esbuild_entry_stub",
  runtimeArtifact: "src/computer/xclaw-server.mjs",
  note: "Full CDP/BrowserService still only inside the runtime artifact until C3 unbundle.",
};

console.error(
  "[xclaw bundle-entry] stub only — not a listen server. Use thin-server or xclaw-server.mjs"
);
