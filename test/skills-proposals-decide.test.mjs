import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// POST /skills/proposals/decide — new for the Skills control-UI section.
// installProposal/rejectProposal existed CLI-side only; the route must stay
// filename-scoped (no separators/..) so a caller can't install from or move
// files outside the proposals dir.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-skdecide-"));
const cfg = { paths: { configDir: TMP, skillsDir: path.join(TMP, "skills") } };

const { tryHandleEvalQueueRoute } = await import("../src/gateway/routes/eval-queue.mjs");

const PROP_DIR = path.join(TMP, "skill-proposals");

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function seedProposal(name) {
  fs.mkdirSync(PROP_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PROP_DIR, name),
    `---\nname: ${name.replace(/\.md$/, "")}\nenabled: false\n---\n\n# proposed skill\n`
  );
}

function call(p, method, body) {
  let out = null, status = null;
  return tryHandleEvalQueueRoute({
    p, method,
    req: { headers: {}, url: p },
    res: {},
    cfg,
    url: new URL("http://x" + p),
    json: (_r, c, payload) => { status = c; out = payload; },
    readBody: async () => body || {},
    root: process.cwd(),
  }).then((handled) => ({ handled, status, out }));
}

// A file OUTSIDE the proposals dir, addressed by ABSOLUTE path with valid
// front matter — the escape vehicle for the slash-arm pin below.
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-skdecide-out-"));
const ABS_EVIL = path.join(OUTSIDE, "outside-evil.md");
fs.writeFileSync(
  ABS_EVIL,
  "---\nname: pwned-abs\nenabled: false\n---\n\n# skill installed from OUTSIDE the proposals dir\n"
);
after(() => {
  fs.rmSync(OUTSIDE, { recursive: true, force: true });
});

describe("POST /skills/proposals/decide", () => {
  it("rejects traversal / pathy filenames", async () => {
    for (const bad of ["../evil.md", "a/b.md", "a\\b.md", "", "x..y/../z.md"]) {
      const { handled, status } = await call("/skills/proposals/decide", "POST", {
        file: bad,
        action: "install",
      });
      assert.equal(handled, true);
      assert.equal(status, 400, `must 400 for ${JSON.stringify(bad)}`);
    }
  });

  // Sweep #40 — absolute-path escape pin. `installProposal` (src/skills/
  // propose.mjs:133) honors `path.isAbsolute(proposalFile)` and reads the path
  // verbatim, so an absolute `file` escapes the proposals dir entirely →
  // arbitrary-file read + install-as-skill. The route's SOLE defense is the
  // `/[/\\]/.test(file)` separator arm at eval-queue.mjs:208 (the `..` arm does
  // NOT catch a `..`-free absolute path like /etc/evil.md). The pre-existing
  // traversal test only fed RELATIVE pathy names, which 400 DOWNSTREAM (ENOENT
  // in installProposal), so dropping the slash arm left the full suite GREEN —
  // the escape was unpinned. This drives a real absolute path to a file with
  // valid front matter and asserts rejection AT THE GUARD (the guard's own
  // error message, not a downstream 400) with nothing written under skillsDir.
  it("rejects an ABSOLUTE-path file (escapes proposals dir) at the guard", async () => {
    const installedSkill = path.join(TMP, "skills", "pwned-abs", "SKILL.md");
    assert.ok(!fs.existsSync(installedSkill), "precondition: skill not present");
    const { handled, status, out } = await call("/skills/proposals/decide", "POST", {
      file: ABS_EVIL,
      action: "install",
    });
    assert.equal(handled, true);
    // Rejected at the separator guard — the guard's message, not a downstream
    // catch (which would be {ok:false, error:<fs error>}). Pins line 208.
    assert.equal(status, 400, "absolute path must be rejected");
    assert.match(
      out.error || "",
      /proposal filename/,
      "must reject at the filename guard, not downstream"
    );
    // The privileged side-effect (install from outside the proposals dir) must
    // NOT have run — no skill written under skillsDir from the escaped file.
    assert.ok(
      !fs.existsSync(installedSkill),
      "absolute-path file must not be installed as a skill"
    );
  });

  it("rejects unknown actions", async () => {
    seedProposal("p1.md");
    const { status, out } = await call("/skills/proposals/decide", "POST", {
      file: "p1.md",
      action: "yolo",
    });
    assert.equal(status, 400);
    assert.match(out.error, /install or reject/);
  });

  it("install enables the skill under skillsDir", async () => {
    seedProposal("p2.md");
    const { status, out } = await call("/skills/proposals/decide", "POST", {
      file: "p2.md",
      action: "install",
    });
    assert.equal(status, 200);
    assert.equal(out.ok, true);
    const dest = out.installed.path;
    assert.ok(dest.startsWith(path.join(TMP, "skills")), `dest inside skillsDir: ${dest}`);
    const body = fs.readFileSync(dest, "utf8");
    assert.match(body, /enabled: true/);
    // source proposal leaves the review queue (archived to installed/)
    assert.ok(!fs.existsSync(path.join(PROP_DIR, "p2.md")), "proposal archived after install");
    assert.ok(fs.existsSync(path.join(PROP_DIR, "installed", "p2.md")));
  });

  it("reject moves the proposal into rejected/ with a reason file", async () => {
    seedProposal("p3.md");
    const { status, out } = await call("/skills/proposals/decide", "POST", {
      file: "p3.md",
      action: "reject",
      reason: "not useful",
    });
    assert.equal(status, 200);
    assert.equal(out.ok, true);
    assert.ok(fs.existsSync(path.join(PROP_DIR, "rejected", "p3.md")));
    assert.equal(
      fs.readFileSync(path.join(PROP_DIR, "rejected", "p3.md.reason.txt"), "utf8"),
      "not useful"
    );
    assert.ok(!fs.existsSync(path.join(PROP_DIR, "p3.md")), "original removed");
  });

  it("missing proposal surfaces a 400, not a crash", async () => {
    const { status, out } = await call("/skills/proposals/decide", "POST", {
      file: "nope.md",
      action: "install",
    });
    assert.equal(status, 400);
    assert.equal(out.ok, false);
  });
});
