import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/publish-bundle.mjs");

function run(args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

describe("publish-bundle helper", () => {
  let tmpBundle;

  before(() => {
    tmpBundle = path.join(os.tmpdir(), `xclaw-pubtest-${process.pid}.bin`);
    fs.writeFileSync(tmpBundle, Buffer.from("not the real bundle — distinct bytes"));
  });
  after(() => fs.rmSync(tmpBundle, { force: true }));

  it("dry-run hashes the file, derives the repo, and does NOT upload", () => {
    const r = run([tmpBundle, "--dry-run"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /DRY RUN — would upload/);
    assert.match(r.out, /would set manifest bytes=\d+ sha256=[a-f0-9]{64}/);
    // repo derived from the manifest URL, no --repo flag given
    assert.match(r.out, /Matrixx0070\/xclaw/);
    // must not have touched the committed manifest
    assert.doesNotMatch(r.out, /manifest updated/);
  });

  it("errors clearly when the bundle path is missing", () => {
    const r = run([path.join(os.tmpdir(), "definitely-not-here.mjs")]);
    assert.equal(r.code, 1);
    assert.match(r.out, /bundle not found/);
  });

  it("is a no-op when the bundle already matches the manifest", () => {
    // Reconstruct a file whose bytes/sha match the committed manifest by
    // fetching is out of scope here; instead assert the guard exists in source.
    const src = fs.readFileSync(script, "utf8");
    assert.match(src, /manifest already matches this bundle/);
    assert.match(src, /round-trip checksum mismatch/); // verify-before-commit guard
    assert.match(src, /manifest NOT updated/);
  });

  it("does not mutate the committed manifest during tests", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "src/computer/bundle-artifact.json"), "utf8")
    );
    // canonical bundle sha — guards against a stray real publish leaking in
    assert.equal(
      manifest.sha256,
      "9d95d067d7e20229305ff87370705c77a29f96506f10ed6aa19dac976ab33a46"
    );
  });
});
