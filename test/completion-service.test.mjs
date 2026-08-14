import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cleanCompletion,
  buildCompletionContext,
  completeCode,
} from "../src/completion/service.mjs";

describe("cleanCompletion", () => {
  it("strips code fences and trailing whitespace", () => {
    assert.equal(cleanCompletion("```js\nreturn a + b;\n```"), "return a + b;");
    assert.equal(cleanCompletion("return a + b;\n\n"), "return a + b;");
  });
  it("cuts an echoed suffix", () => {
    const suffix = "\n}\n\nmodule.exports = { add };";
    const raw = "return a + b;\n}\n\nmodule.exports = { add };";
    assert.equal(cleanCompletion(raw, { suffix }), "return a + b;");
  });
  it("keeps content when no suffix echo", () => {
    assert.equal(cleanCompletion("return a + b;", { suffix: "\n}" }), "return a + b;");
  });
});

describe("buildCompletionContext", () => {
  let repo;
  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-complete-"));
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(
      path.join(repo, "src", "cart.js"),
      `const { formatPrice } = require("./money.js");\nfunction cartTotal(items) { return items.length; }\nmodule.exports = { cartTotal };\n`
    );
    fs.writeFileSync(
      path.join(repo, "src", "money.js"),
      `function formatPrice(cents) { return "$" + (cents / 100).toFixed(2); }\nmodule.exports = { formatPrice };\n`
    );
    fs.writeFileSync(
      path.join(repo, "src", "unrelated.js"),
      `function nothing() {}\nmodule.exports = { nothing };\n`
    );
  });
  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("includes imported neighbors' symbols, not unrelated files", async () => {
    const ctx = await buildCompletionContext(repo, "src/cart.js");
    assert.ok(ctx.files.includes("src/money.js"), JSON.stringify(ctx.files));
    assert.match(ctx.text, /formatPrice/);
    assert.ok(!ctx.files.includes("src/unrelated.js"));
  });
  it("no repoDir → empty context, no crash", async () => {
    const ctx = await buildCompletionContext(null, "x.js");
    assert.equal(ctx.text, "");
  });
});

describe("completeCode with injected provider", () => {
  it("prompt carries prefix, suffix, context; result is cleaned", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-complete2-"));
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(path.join(repo, "src", "util.js"), `function helper() {}\nmodule.exports = { helper };\n`);
    fs.writeFileSync(path.join(repo, "src", "main.js"), `const { helper } = require("./util.js");\n`);
    let seenMessages = null;
    const provider = {
      providerName: "fake",
      model: "fake-1",
      async chat({ messages }) {
        seenMessages = messages;
        return { message: { role: "assistant", content: "```js\nreturn helper();\n```" } };
      },
    };
    const out = await completeCode({}, {
      prefix: "function run() {\n  ",
      suffix: "\n}",
      file: "src/main.js",
      repoDir: repo,
      provider,
    });
    assert.equal(out.completion, "return helper();");
    assert.equal(out.model, "fake-1");
    const user = seenMessages.find((m) => m.role === "user").content;
    assert.match(user, /<CURSOR>/);
    assert.match(user, /function run\(\) \{/);
    assert.match(user, /FILE: src\/main\.js/);
    assert.match(user, /helper/, "neighborhood context included");
    const sys = seenMessages.find((m) => m.role === "system").content;
    assert.match(sys, /ONLY the code to insert/);
    fs.rmSync(repo, { recursive: true, force: true });
  });
  it("empty prefix rejected", async () => {
    await assert.rejects(() => completeCode({}, { prefix: "  " }), /prefix required/);
  });
});

describe("buffer-derived imports (new/unsaved files)", () => {
  it("context resolves from the prefix buffer when the file is not on disk", async () => {
    const os2 = await import("node:os");
    const repo = fs.mkdtempSync(path.join(os2.default.tmpdir(), "xclaw-complete3-"));
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(path.join(repo, "src", "money.js"), `function formatPrice(c){}\nmodule.exports = { formatPrice };\n`);
    const ctx = await buildCompletionContext(repo, "src/brand-new.js", {
      buffer: `const { formatPrice } = require("./money.js");\nfunction x() {`,
    });
    assert.ok(ctx.files.includes("src/money.js"), JSON.stringify(ctx.files));
    assert.match(ctx.text, /formatPrice/);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
