import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAllLocalTools, localToolNames } from "../src/tools/registry.mjs";
import { listCatalogTools } from "../src/connected/catalog.mjs";
import { listArtifacts } from "../src/artifacts/browser.mjs";

describe("P3", () => {
  it("registers semantic and browser tools", () => {
    const n = localToolNames(createAllLocalTools({ workingDir: process.cwd() }));
    assert.ok(n.includes("x_semantic_search"));
    assert.ok(n.includes("browser_clipboard"));
    assert.ok(n.includes("browser_pdf"));
  });

  it("connected catalog has github and voice", () => {
    const tools = listCatalogTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("voice_speak"));
    assert.ok(names.includes("github_request"));
  });

  it("listArtifacts returns structure", async () => {
    const r = await listArtifacts(process.cwd());
    assert.ok(typeof r.count === "number");
    assert.ok(Array.isArray(r.files));
  });
});
