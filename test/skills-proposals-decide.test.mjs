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
