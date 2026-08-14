import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scanRepo,
  extractSymbols,
  extractImports,
  buildTaskContext,
} from "../src/intel/repo-intel.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-intel-"));

before(() => {
  fs.mkdirSync(path.join(TMP, "src"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP, "src", "auth.mjs"),
    `import { hashPassword } from "./crypto.mjs";\nexport function login(user) { return hashPassword(user); }\nexport class AuthService {}\n`
  );
  fs.writeFileSync(
    path.join(TMP, "src", "crypto.mjs"),
    `export function hashPassword(p) { return p; }\n`
  );
  fs.writeFileSync(path.join(TMP, "package.json"), `{"name":"x","scripts":{"test":"true"}}`);
  fs.writeFileSync(path.join(TMP, "node_modules", "junk", "index.js"), "module.exports = 1;");
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("repo intel", () => {
  it("scanRepo skips node_modules and classifies kinds", async () => {
    const files = await scanRepo(TMP);
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("src/auth.mjs"));
    assert.ok(paths.includes("package.json"));
    assert.ok(!paths.some((p) => p.includes("node_modules")), "node_modules excluded");
    assert.equal(files.find((f) => f.path === "package.json").kind, "config");
  });

  it("extractSymbols finds functions and classes", () => {
    const src = fs.readFileSync(path.join(TMP, "src", "auth.mjs"), "utf8");
    const syms = extractSymbols("src/auth.mjs", src);
    const names = syms.map((s) => s.name);
    assert.ok(names.includes("login"));
    assert.ok(names.includes("AuthService"));
  });

  it("extractImports finds relative deps", () => {
    const src = fs.readFileSync(path.join(TMP, "src", "auth.mjs"), "utf8");
    assert.deepEqual(extractImports("src/auth.mjs", src), ["./crypto.mjs"]);
  });

  it("buildTaskContext ranks auth files first for an auth task", async () => {
    const ctx = await buildTaskContext(TMP, "refactor the authentication login system");
    assert.ok(ctx.contextText.includes("src/auth.mjs"));
    assert.ok(ctx.files.length >= 1);
    assert.equal(ctx.files[0].path, "src/auth.mjs", "highest-scored file is the auth module");
    assert.ok(ctx.stats.keywords.includes("authentication") || ctx.stats.keywords.includes("login"));
  });
});
