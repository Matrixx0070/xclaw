import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveElementSource, descriptorSignals, PICKER_JS } from "../src/intel/element-resolver.mjs";
import { buildPointGoal } from "../src/gateway/routes/point.mjs";
import { createCdpClient } from "../src/browser/cdp-client.mjs";

describe("descriptorSignals", () => {
  it("ids and data-attrs are strong; short classes are dropped", () => {
    const sigs = descriptorSignals({
      id: "checkout-btn",
      classes: ["btn", "primary-action"],
      attrs: { "data-testid": "checkout", type: "submit" },
      text: "Buy now",
    });
    const labels = sigs.map((s) => s.label);
    assert.ok(labels.includes("id:checkout-btn"));
    assert.ok(labels.includes("class:primary-action"));
    assert.ok(!labels.includes("class:btn"), "sub-3-char class dropped? (btn is 3)");
    assert.ok(labels.some((l) => l.startsWith("data-testid=")));
    assert.ok(labels.some((l) => l.startsWith('text:"Buy now"')));
  });
});

describe("resolveElementSource", () => {
  let repo;
  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-point-"));
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(
      path.join(repo, "src", "header.html"),
      `<header>\n  <h1 id="site-title" class="hero-title">Welcome to DemoWeb</h1>\n  <button data-testid="checkout" class="primary-action">Buy now</button>\n</header>\n`
    );
    fs.writeFileSync(
      path.join(repo, "src", "style.css"),
      `.hero-title { color: red; }\n#site-title { font-size: 2rem; }\n`
    );
    fs.writeFileSync(
      path.join(repo, "src", "unrelated.js"),
      `console.log("nothing to see");\n`
    );
  });
  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("ranks the defining markup first; css also surfaces; unrelated files don't", async () => {
    const { matches } = await resolveElementSource(repo, {
      tag: "h1",
      id: "site-title",
      classes: ["hero-title"],
      text: "Welcome to DemoWeb",
    });
    assert.ok(matches.length >= 2, JSON.stringify(matches));
    assert.equal(matches[0].file, "src/header.html");
    assert.ok(matches[0].matchedOn.some((l) => l.startsWith("id:")));
    assert.ok(matches.some((m) => m.file === "src/style.css"));
    assert.ok(!matches.some((m) => m.file === "src/unrelated.js"));
  });

  it("empty descriptor → no matches, no crash", async () => {
    const r = await resolveElementSource(repo, { tag: "div" });
    assert.deepEqual(r.matches, []);
  });
});

describe("buildPointGoal", () => {
  it("embeds prompt, element and ranked locations", () => {
    const goal = buildPointGoal(
      "make the title blue",
      { tag: "h1", selector: "#site-title", id: "site-title", classes: ["hero-title"], text: "Welcome" },
      [{ file: "src/header.html", line: 2, matchedOn: ["id:site-title"] }]
    );
    assert.match(goal, /make the title blue/);
    assert.match(goal, /TARGET ELEMENT/);
    assert.match(goal, /src\/header\.html:2/);
    assert.match(goal, /rebuild\/run the project's checks/);
  });
});

describe("cdp-client guardrails", () => {
  it("refuses non-loopback hosts without allowRemote", () => {
    assert.throws(() => createCdpClient({ host: "10.0.0.5", port: 9222 }), /not loopback/);
    assert.ok(createCdpClient({ host: "127.0.0.1", port: 9222 }));
  });
  it("picker script is syntactically valid and one-shot-armed", async () => {
    const vm = await import("node:vm");
    // compile-only syntax check of our own build-time constant (never run)
    assert.doesNotThrow(() => new vm.Script(PICKER_JS));
    assert.match(PICKER_JS, /__xclawPick/);
    assert.match(PICKER_JS, /Escape/);
  });
});
