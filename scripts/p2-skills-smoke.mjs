#!/usr/bin/env node
/**
 * P3 — Skill CI smoke: verify bundled skill manifests + required scripts exist.
 * Does not require LibreOffice/ffmpeg binaries for structure check.
 * Optional: XCLAW_SKILL_LIVE=1 runs minimal python --help where scripts exist.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = path.join(root, "skills", "bundled");
const required = [
  "docx", "pptx", "xlsx", "pdf", "ffmpeg", "imagemagick",
  "tasks", "mcp", "memory-edit", "skill-creator", "skill-installer",
];

const report = { ok: true, skills: [] };

for (const name of required) {
  const dir = path.join(bundled, name);
  const skillMd = path.join(dir, "SKILL.md");
  const entry = { name, ok: true, issues: [] };
  try {
    await fs.access(skillMd);
  } catch {
    entry.ok = false;
    entry.issues.push("missing SKILL.md");
  }
  try {
    const scripts = path.join(dir, "scripts");
    const st = await fs.stat(scripts).catch(() => null);
    if (st?.isDirectory()) {
      const files = await fs.readdir(scripts);
      entry.scriptCount = files.length;
      if (!files.length) {
        entry.issues.push("scripts/ empty");
        entry.ok = false;
      }
    } else {
      entry.scriptCount = 0;
      // tasks/mcp may be md-only
      if (["docx", "pptx", "xlsx", "pdf"].includes(name)) {
        entry.issues.push("missing scripts/");
        entry.ok = false;
      }
    }
  } catch (e) {
    entry.ok = false;
    entry.issues.push(String(e.message || e));
  }
  if (!entry.ok) report.ok = false;
  report.skills.push(entry);
  console.error(`[skills-smoke] ${entry.ok ? "OK" : "FAIL"} ${name}`, entry.issues.join("; ") || `scripts=${entry.scriptCount}`);
}

// Optional live python import on docx helper
if (process.env.XCLAW_SKILL_LIVE === "1") {
  const py = path.join(bundled, "docx", "scripts", "inspect_doc.py");
  const r = spawnSync("python3", [py, "--help"], { encoding: "utf8", timeout: 10000 });
  report.docxHelp = { status: r.status, stderr: (r.stderr || "").slice(0, 200) };
  if (r.status !== 0 && r.status !== null) {
    // many scripts may not implement --help
    console.error("[skills-smoke] docx help status", r.status);
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
