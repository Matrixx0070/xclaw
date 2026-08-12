import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveComputerEngine } from "../src/computer/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Strategy C computer policy", () => {
  it("SOURCE_OF_TRUTH declares strategy C", () => {
    const sot = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/SOURCE_OF_TRUTH.json"), "utf8")
    );
    assert.equal(sot.strategy, "C");
    assert.equal(sot.policy?.handEditBundle, false);
  });

  it("bundle artifact is manifested (opt-in release download, not in git)", () => {
    // The 16MB CDP bundle lives in a GitHub release, not the repo. The
    // committed manifest is the source of truth; the file is optional locally.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/bundle-artifact.json"), "utf8")
    );
    assert.equal(manifest.file, "src/computer/xclaw-server.mjs");
    assert.ok(manifest.bytes > 1_000_000, "manifest records a >1MB artifact");
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/, "manifest has a sha256");
    assert.ok(manifest.url.includes("/releases/"), "manifest points at a release asset");
    // If a local copy exists, it MUST match the manifest checksum.
    const p = path.join(root, manifest.file);
    if (fs.existsSync(p)) {
      const got = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      assert.equal(got, manifest.sha256, "local bundle checksum matches manifest");
    }
  });

  it("bundle artifact is not tracked in git", () => {
    const r = spawnSync("git", ["ls-files", "--error-unmatch", "src/computer/xclaw-server.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0, "xclaw-server.mjs must be untracked (release artifact)");
  });

  it("MODULE_MAP extracted modules exist", () => {
    const map = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/MODULE_MAP.json"), "utf8")
    );
    for (const e of map.extracted) {
      assert.ok(
        fs.existsSync(path.join(root, e.path)),
        `missing ${e.path}`
      );
    }
  });

  it("build:computer stub exits 0 and writes stamp", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/build-computer-bundle.mjs")],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const stamp = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/build-stamp.json"), "utf8")
    );
    assert.equal(stamp.strategy, "C");
    assert.ok(["C1","C2","C3"].includes(stamp.phase));
    assert.equal(stamp.fullRebuild, false);
  });

  it("transitional default engine is still native", () => {
    assert.equal(resolveComputerEngine({}), "native");
  });

  it("bundle engine selectable", () => {
    assert.equal(
      resolveComputerEngine({ computer: { engine: "bundle" } }),
      "bundle"
    );
  });
});
