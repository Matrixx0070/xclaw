/**
 * RULE(m) sweep #61 — the systemd secrets env file (`writeEnvFile`,
 * spec'd "mode 600" in its own doc comment) is unconditionally plaintext
 * (systemd reads K=V), so the owner-only mode is the sole at-rest
 * control. Proven blind spot: `0o600 → 0o644` left the FULL suite green
 * (3856/0). The chmod after the write is the authoritative mode line —
 * a rewrite over a tampered world-readable file must re-tighten it
 * (writeFile's mode is create-only and umask-masked).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeEnvFile } from "../src/cli/daemon.mjs";

const FAKE_KEY = "xai-FAKE-000000000000000000000000-not-real";

function tmpEnvPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-envfile-"));
  return path.join(dir, "env");
}

describe("daemon env file mode (sweep #61)", () => {
  it("fresh write: plaintext K=V on disk, then mode 0o600", () => {
    const fp = tmpEnvPath();
    try {
      const out = writeEnvFile(fp, {
        XCLAW_API_KEY: FAKE_KEY,
        EMPTY: "",
        NULLISH: null,
        MULTI: "line1\nline2",
      });
      assert.equal(out, fp);
      const body = fs.readFileSync(fp, "utf8");
      assert.match(body, new RegExp(`^XCLAW_API_KEY=${FAKE_KEY}$`, "m"));
      assert.match(body, /^MULTI=line1line2$/m);
      assert.doesNotMatch(body, /^EMPTY=/m);
      assert.doesNotMatch(body, /^NULLISH=/m);
      assert.equal(fs.statSync(fp).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(path.dirname(fp), { recursive: true, force: true });
    }
  });

  it("rewrite over a tampered world-readable file re-tightens to 0o600 (the chmod line)", () => {
    const fp = tmpEnvPath();
    try {
      writeEnvFile(fp, { XCLAW_API_KEY: FAKE_KEY });
      fs.chmodSync(fp, 0o644);
      assert.equal(fs.statSync(fp).mode & 0o777, 0o644, "tamper precondition");
      writeEnvFile(fp, { XCLAW_API_KEY: FAKE_KEY + "-2" });
      assert.equal(
        fs.statSync(fp).mode & 0o777,
        0o600,
        "only the chmod after the write can repair an existing inode's mode",
      );
      assert.match(fs.readFileSync(fp, "utf8"), /-2$/m);
    } finally {
      fs.rmSync(path.dirname(fp), { recursive: true, force: true });
    }
  });
});
