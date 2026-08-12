import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import {
  resolveComputerEngine,
  resolveComputerEntryPath,
} from "../src/computer/engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Strategy C3 generated computer", () => {
  it("build:computer emits generated server and never creates the 16MB bundle", () => {
    const bundle = path.join(root, "src/computer/xclaw-server.mjs");
    const before = fs.existsSync(bundle) ? fs.statSync(bundle).size : null;
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/build-computer-bundle.mjs")],
      { encoding: "utf8", cwd: root }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const gen = path.join(root, "src/computer/generated/computer-server.mjs");
    assert.ok(fs.existsSync(gen));
    assert.ok(fs.statSync(gen).size > 1000);
    // The build must never write the bundle: absent stays absent; present unchanged.
    const after = fs.existsSync(bundle) ? fs.statSync(bundle).size : null;
    assert.equal(after, before);
    const stamp = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/build-stamp.json"), "utf8")
    );
    assert.equal(stamp.phase, "C3");
    assert.equal(stamp.legacyOverwritten, false);
    assert.equal(stamp.generatedEmit, true);
  });

  it("engine resolves generated entry", () => {
    assert.equal(
      resolveComputerEngine({ computer: { engine: "generated" } }),
      "generated"
    );
    const entry = resolveComputerEntryPath(
      { computer: { engine: "generated" } },
      root
    );
    assert.match(entry, /generated\/computer-server\.mjs$/);
  });

  it("generated server serves /health", async () => {
    const entry = path.join(root, "src/computer/generated/computer-server.mjs");
    const port = 4261;
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        XCLAW_COMPUTER_PORT: String(port),
        XCLAW_COMPUTER_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise((r) => setTimeout(r, 800));
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(res.ok, true);
      const j = await res.json();
      assert.equal(j.ok, true);
      assert.ok(Array.isArray(j.tools) ? j.tools.length >= 1 : true);
    } finally {
      child.kill("SIGTERM");
    }
  });
});
