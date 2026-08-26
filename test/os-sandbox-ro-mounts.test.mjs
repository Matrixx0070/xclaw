import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  roBindDirsArgv,
  buildBwrapArgv,
  findBwrap,
  resetBwrapCache,
} from "../src/security/os-sandbox.mjs";

// The OS sandbox (bubblewrap) mounts the host system directories
// (/usr,/etc,/bin,/sbin,/lib*) into the sandbox namespace READ-ONLY via
// --ro-bind, so a sandboxed agent command cannot tamper with system binaries or
// config. roBindDirsArgv() is the single source of those mounts — buildBwrapArgv
// splices its output in at the "RO system paths" step (os-sandbox.mjs:256),
// ahead of the deliberately-writable --bind of the workspace.
//
// Nothing asserted the read-only FLAG. Flipping --ro-bind -> --bind on
// os-sandbox.mjs:94 makes /usr,/etc,/bin,/sbin,/lib* WRITABLE inside the
// production sandbox for every operator who enables it, yet the FULL suite
// stayed green (3675/0) under exactly that mutation — the read-only containment
// of the sandbox system mounts was entirely unpinned (mutation-sweep #56).

describe("OS sandbox read-only system mounts", () => {
  it("roBindDirsArgv mounts system dirs --ro-bind and never writable --bind", () => {
    const argv = roBindDirsArgv({});
    assert.ok(argv.length > 0, "expected at least one system dir to be bound");
    assert.ok(argv.includes("--ro-bind"), "system dirs must be mounted --ro-bind");
    assert.ok(
      !argv.includes("--bind"),
      "system dirs must NEVER be writable (--bind) — a sandboxed command could then overwrite /usr,/etc,/bin"
    );
    // /usr exists on every Linux host; the flag immediately before it is the mount mode.
    const usrIdx = argv.indexOf("/usr");
    assert.ok(usrIdx >= 1, "/usr should be bound");
    assert.equal(argv[usrIdx - 1], "--ro-bind", "/usr must be mounted read-only");
    // roBindDirsArgv emits ONLY --ro-bind triples [flag, src, dst] — verify every one.
    for (let i = 0; i < argv.length; i += 3) {
      assert.equal(argv[i], "--ro-bind", `mount at ${i} must be read-only, got ${argv[i]}`);
      assert.equal(argv[i + 1], argv[i + 2], "src and dst of a system mount must match");
    }
  });

  it("the assembled production bwrap argv keeps /usr read-only while binding the workspace writable", (t) => {
    resetBwrapCache();
    if (!findBwrap()) {
      t.skip("bubblewrap not installed");
      return;
    }
    const built = buildBwrapArgv({
      cfg: { security: { osSandbox: "bwrap" } },
      cwd: process.cwd(),
      workspace: process.cwd(),
    });
    if (!built.ok) {
      t.skip(`bwrap argv unavailable: ${built.reason}`);
      return;
    }
    const a = built.argvPrefix;
    const usrIdx = a.indexOf("/usr");
    assert.ok(usrIdx >= 1, "/usr should appear in the assembled argv");
    assert.equal(
      a[usrIdx - 1],
      "--ro-bind",
      "/usr must stay read-only in the full production argv"
    );
    // The workspace IS legitimately bound writable — read-only-ness is per-path,
    // so --bind appearing at all is expected; only the SYSTEM dirs must be ro.
    assert.ok(a.includes("--bind"), "the workspace should be bound writable (--bind)");
  });
});
