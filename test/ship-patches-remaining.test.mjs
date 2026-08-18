import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRA_SHIP_PATCHES } from "../src/ci/ship-patches-extra.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("SHIP_PATCHES remaining", () => {
  it("lists this batch", () => {
    const files = EXTRA_SHIP_PATCHES.map((e) => e.file);
    for (const f of [
      "job-history-hash-tip.patch",
      "memory-soak-redact.patch",
      "gateway-digest-cron-boot.patch",
      "stamp-job-tool-hash.patch",
      "doctor-perf-ensure.patch",
      "release-gate-ensure-cold-start.patch",
    ]) {
      assert.ok(files.includes(f), f);
    }
  });

  it("each extra patch file exists", () => {
    for (const e of EXTRA_SHIP_PATCHES) {
      assert.ok(fs.existsSync(path.join(root, "patches", e.file)), e.file);
    }
  });
});
