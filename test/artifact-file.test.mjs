import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveArtifactFile } from "../src/gateway/artifact-file.mjs";

describe("artifact file resolution (GET /artifacts/file)", () => {
  let root, other;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-art-"));
    other = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-art-outside-"));
    await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, "artifacts", "pic.png"), Buffer.from([0x89, 0x50]));
    await fs.writeFile(path.join(root, "artifacts", "notes.md"), "# hi");
    await fs.writeFile(path.join(root, "artifacts", "script.sh"), "echo no");
    await fs.writeFile(path.join(other, "secret.png"), Buffer.from([1]));
    await fs.symlink(path.join(other, "secret.png"), path.join(root, "artifacts", "link.png"));
  });
  after(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    await fs.rm(other, { recursive: true, force: true }).catch(() => {});
  });

  it("serves an allowed file inside the root (relative + absolute)", async () => {
    const rel = await resolveArtifactFile(root, "artifacts/pic.png");
    assert.equal(rel.ok, true);
    assert.equal(rel.mime, "image/png");
    const abs = await resolveArtifactFile(root, path.join(root, "artifacts", "pic.png"));
    assert.equal(abs.ok, true);
  });

  it("blocks ../ traversal", async () => {
    const r = await resolveArtifactFile(root, "../" + path.basename(other) + "/secret.png");
    assert.equal(r.ok, false);
  });

  it("blocks absolute paths outside every root", async () => {
    const r = await resolveArtifactFile(root, path.join(other, "secret.png"));
    assert.equal(r.ok, false);
    assert.equal(r.code, "outside_workspace");
  });

  it("blocks symlink escapes", async () => {
    const r = await resolveArtifactFile(root, "artifacts/link.png");
    assert.equal(r.ok, false);
    assert.equal(r.code, "outside_workspace");
  });

  it("blocks disallowed extensions", async () => {
    const r = await resolveArtifactFile(root, "artifacts/script.sh");
    assert.equal(r.ok, false);
    assert.equal(r.code, "type_not_allowed");
  });

  it("multiple roots: found in the second root", async () => {
    const r = await resolveArtifactFile([other + "-nope", root], "artifacts/notes.md");
    assert.equal(r.ok, true);
    assert.match(r.mime, /markdown/);
  });

  it("filesystem root is never an acceptable root", async () => {
    const r = await resolveArtifactFile("/", "etc/hostname");
    assert.equal(r.ok, false);
    assert.equal(r.code, "bad_root");
  });
});
