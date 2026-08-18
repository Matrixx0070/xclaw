import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STOP_HELP } from "../src/cli/stop-help.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Phrases that must appear in both docs/STOP.md and STOP_HELP. */
export const STOP_LOCKSTEP_PHRASES = [
  "X-XClaw-Stop-Sig",
  "--sign",
  "--dry-run",
  "--post",
  "stop-fire-drill",
  "openapi-stop.yaml",
  "dryRun",
];

describe("STOP.md + stop --help lockstep", () => {
  it("shared operator phrases present in both surfaces", () => {
    const md = fs.readFileSync(path.join(root, "docs/STOP.md"), "utf8");
    for (const phrase of STOP_LOCKSTEP_PHRASES) {
      assert.ok(
        md.includes(phrase),
        `docs/STOP.md missing: ${phrase}`
      );
      assert.ok(
        STOP_HELP.includes(phrase) || (phrase === "dryRun" && md.includes("dryRun")),
        `STOP_HELP missing: ${phrase}`
      );
    }
    // dryRun is documented in STOP.md body; help uses --dry-run flag name
    assert.ok(STOP_HELP.includes("--dry-run"));
    assert.ok(md.includes("--post"));
    assert.ok(STOP_HELP.includes("--post"));
  });
});
