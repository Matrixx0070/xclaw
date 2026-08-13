import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HookManager,
  createHookManager,
  HOOK_CATEGORIES,
} from "../src/hooks/manager.mjs";
import { registerExampleHooks, redactSecretsHook } from "../src/hooks/examples.mjs";

const silent = () => {};

describe("HookManager registration + validation", () => {
  it("rejects unknown categories, non-callables, bad arity, bad tiers", () => {
    const m = new HookManager({ logger: silent });
    assert.throws(() => m.registerHook("nope", () => {}), /unknown hook category/);
    assert.throws(() => m.registerHook("pre_process", "str"), /must be callable/);
    assert.throws(() => m.registerHook("pre_process", (a, b) => [a, b]), /single context argument/);
    assert.throws(() => m.registerHook("pre_process", () => {}, { tier: "root" }), /unknown tier/);
  });

  it("registers, lists, removes by id and by category+name", () => {
    const m = new HookManager({ logger: silent });
    const id = m.registerHook("on_request", () => {}, { name: "a", tier: "user" });
    m.registerHook("on_request", () => {}, { name: "b" });
    m.registerHook("on_response", () => {}, { name: "b" });
    assert.equal(m.listHooks().length, 3);
    assert.equal(m.removeHook(id), 1);
    assert.equal(m.removeHook("on_request", "b"), 1);
    assert.deepEqual(m.listHooks().map((h) => h.category), ["on_response"]);
  });

  it("every declared category exists", () => {
    const m = new HookManager({ logger: silent });
    for (const c of HOOK_CATEGORIES) m.registerHook(c, () => {});
    assert.equal(m.listHooks().length, HOOK_CATEGORIES.length);
  });
});

describe("permission tiers", () => {
  it("system sees cfg, trusted does not, user gets a read-only copy", async () => {
    const m = new HookManager({ logger: silent });
    const seen = {};
    m.registerHook("pre_process", (ctx) => { seen.system = ctx; }, { tier: "system", name: "s" });
    m.registerHook("pre_process", (ctx) => { seen.trusted = ctx; }, { tier: "trusted", name: "t" });
    m.registerHook("pre_process", (ctx) => { seen.user = ctx; ctx.message = "hacked"; }, { tier: "user", name: "u" });
    const context = { message: "hi", cfg: { secret: true } };
    const out = await m.executeAll("pre_process", context, { mutable: ["message"] });
    assert.ok(seen.system.cfg, "system sees cfg");
    assert.equal(seen.trusted.cfg, undefined, "trusted gets no cfg");
    assert.equal(seen.user.cfg, undefined, "user gets no cfg");
    // user mutated its own COPY — the real context is untouched
    assert.equal(out.context.message, "hi");
  });

  it("mutation whitelist: only listed fields move, only for system/trusted", async () => {
    const m = new HookManager({ logger: silent });
    m.registerHook("post_process", () => ({ text: "T", other: "X" }), { tier: "trusted" });
    m.registerHook("post_process", () => ({ text: "USER" }), { tier: "user" });
    const out = await m.executeAll("post_process", { text: "orig", other: "o" }, { mutable: ["text"] });
    assert.equal(out.context.text, "T", "trusted mutation applied");
    assert.equal(out.context.other, "o", "non-whitelisted field ignored");
  });

  it("abort: honored for system, ignored for trusted, chain stops on abort", async () => {
    const m = new HookManager({ logger: silent });
    let ranAfter = false;
    m.registerHook("pre_process", () => ({ abort: "nope" }), { tier: "trusted", name: "t" });
    m.registerHook("pre_process", () => ({ abort: "blocked by policy" }), { tier: "system", name: "s" });
    m.registerHook("pre_process", () => { ranAfter = true; }, { tier: "user", name: "late" });
    const out = await m.executeAll("pre_process", { message: "x" });
    assert.equal(out.abort, "blocked by policy");
    assert.equal(ranAfter, false, "hooks after a system abort do not run");
    assert.equal(out.results.find((r) => r.name === "t").abortIgnored, true);
  });

  it("module loader caps tiers at the operator-assigned level", () => {
    const m = new HookManager({ logger: silent });
    // simulate what _ensureModules passes to a module's register()
    const facade = {
      registerHook: (cat, fn, o = {}) => m.registerHook(cat, fn, { ...o, maxTier: "user" }),
    };
    facade.registerHook("pre_process", () => {}, { tier: "system", name: "sneaky" });
    assert.equal(m.listHooks()[0].tier, "user", "self-claimed system clamped to user");
  });
});

describe("error isolation + timeout + logging", () => {
  it("a throwing hook is contained; later hooks still run", async () => {
    const m = new HookManager({ logger: silent });
    let ran = false;
    m.registerHook("on_error", () => { throw new Error("boom"); }, { name: "bad" });
    m.registerHook("on_error", () => { ran = true; }, { name: "good" });
    const out = await m.executeAll("on_error", {});
    assert.equal(out.results[0].ok, false);
    assert.match(out.results[0].error, /boom/);
    assert.equal(ran, true);
  });

  it("a hanging hook is cut off at timeoutMs", async () => {
    const m = new HookManager({ cfg: { hooks: { timeoutMs: 100, log: false } }, logger: silent });
    m.registerHook("on_request", () => new Promise(() => {}), { name: "hang" });
    const t0 = Date.now();
    const out = await m.executeAll("on_request", {});
    assert.equal(out.results[0].ok, false);
    assert.match(out.results[0].error, /timed out/);
    assert.ok(Date.now() - t0 < 1500, "did not wait forever");
  });

  it("history records registrations and executions", async () => {
    const m = new HookManager({ logger: silent });
    m.registerHook("on_request", () => {}, { name: "obs" });
    await m.executeAll("on_request", {});
    const events = m.history().map((h) => h.event);
    assert.ok(events.includes("registered"));
    assert.ok(events.includes("executed"));
  });
});

describe("config gating", () => {
  it("global kill-switch skips execution", async () => {
    const m = createHookManager({ cfg: { hooks: { enabled: false } }, logger: silent });
    let ran = false;
    m.registerHook("pre_process", () => { ran = true; });
    const out = await m.executeAll("pre_process", {});
    assert.equal(out.skipped, "disabled");
    assert.equal(ran, false);
  });

  it("per-category disable skips only that category", async () => {
    const m = createHookManager({
      cfg: { hooks: { categories: { on_request: false }, log: false } },
      logger: silent,
    });
    let req = false, resp = false;
    m.registerHook("on_request", () => { req = true; });
    m.registerHook("on_response", () => { resp = true; });
    await m.executeAll("on_request", {});
    await m.executeAll("on_response", {});
    assert.equal(req, false);
    assert.equal(resp, true);
  });
});

describe("example hooks", () => {
  it("system redact-secrets scrubs credentials from output", async () => {
    const m = new HookManager({ logger: silent });
    registerExampleHooks(m, { sink: { log: silent } });
    const out = await m.executeAll(
      "post_process",
      { text: "key sk-ant-oat01-abc12345XYZ and Bearer abcdefghijklmnop1234 done" },
      { mutable: ["text"] }
    );
    assert.ok(!out.context.text.includes("sk-ant-oat01-abc12345XYZ"));
    assert.ok(out.context.text.includes("sk-ant-[REDACTED]"));
    assert.ok(out.context.text.includes("Bearer [REDACTED]"));
  });

  it("trusted timestamp-context annotates the message once", async () => {
    const m = new HookManager({ logger: silent });
    registerExampleHooks(m, { sink: { log: silent } });
    const out = await m.executeAll("pre_process", { message: "what time is it?" }, { mutable: ["message"] });
    assert.match(out.context.message, /\[context: current time is /);
    const again = await m.executeAll("pre_process", { message: out.context.message }, { mutable: ["message"] });
    assert.equal(
      (again.context.message.match(/\[context:/g) || []).length, 1,
      "no double annotation"
    );
  });

  it("user timing-logger observes without mutating", async () => {
    const lines = [];
    const m = new HookManager({ logger: silent });
    registerExampleHooks(m, { sink: { log: (l) => lines.push(l) } });
    await m.executeAll("on_request", { turn: 1 });
    await m.executeAll("on_response", { turn: 1, finishReason: "stop" });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /turn 1 model round-trip \d+ms/);
  });

  it("redactSecretsHook returns undefined when nothing matches (no-op)", () => {
    assert.equal(redactSecretsHook({ text: "clean text" }), undefined);
  });
});
