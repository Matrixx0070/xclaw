/**
 * swarm-ext integration-glue tests.
 *
 * CI-safe by design: imports ONLY dependency-free files (defaults.mjs,
 * src/swarm-ext/llm-adapter.mjs). The extension's own deps
 * (express/ioredis/zod) are NOT installed in CI — vendor code is exercised
 * by `npm test --prefix src/swarm-ext` locally instead.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG as DEFAULTS } from "../src/config/defaults.mjs";
import { wrapProvider, extractJson } from "../src/swarm-ext/llm-adapter.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("swarm-ext is OFF by default", () => {
  assert.equal(DEFAULTS.swarmExt?.enabled, false);
  assert.equal(DEFAULTS.swarmExt?.maxSubAgents, 25);
});

test("native swarm defaults untouched by swarm-ext addition", () => {
  assert.equal(DEFAULTS.swarm?.enabled, true);
  assert.equal(DEFAULTS.swarm?.maxParallel, 3);
  assert.equal(DEFAULTS.swarm?.maxChildrenPerRun, 8);
});

test("gateway gates /api/swarm behind swarmExt.enabled", () => {
  const src = readFileSync(join(root, "src/gateway/index.mjs"), "utf8");
  assert.match(src, /cfg\.swarmExt\?\.enabled/);
  assert.match(src, /SWARM_EXT_DISABLED/);
  assert.match(src, /swarm-ext\/mount\.mjs/);
});

test("auth protects /api/swarm in the both-modes core list", () => {
  const src = readFileSync(join(root, "src/gateway/auth.mjs"), "utf8");
  assert.match(src, /p\.startsWith\("\/api\/swarm\/"\)/);
});

test("core package.json stays zero-dependency", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
});

test("vendored tree present with no node-fetch imports (removed vendor bug)", () => {
  const orch = readFileSync(join(root, "src/swarm-ext/src/swarm/orchestrator.mjs"), "utf8");
  assert.match(orch, /class Orchestrator/);
  for (const f of ["web-search", "web-extract", "web-crawl", "image-generate", "tts"]) {
    const t = readFileSync(join(root, `src/swarm-ext/plugins/${f}/tool.mjs`), "utf8");
    assert.ok(!t.includes("node-fetch"), `${f} still imports node-fetch`);
  }
});

// ——— llm-adapter unit tests (pure) ———

function fakeProvider(replies) {
  const calls = [];
  let i = 0;
  return {
    calls,
    model: "grok-test",
    async chat(args) {
      calls.push(args);
      const r = replies[Math.min(i++, replies.length - 1)];
      return typeof r === "function" ? r(args) : r;
    },
  };
}

test("adapter.chat maps xclaw provider shape to vendor shape", async () => {
  const p = fakeProvider([
    {
      message: {
        content: "hello",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "calculator", arguments: '{"expr":"1+1"}' } },
        ],
      },
      finishReason: "tool_calls",
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    },
  ]);
  const llm = wrapProvider(p);
  const out = await llm.chat([{ role: "user", content: "hi" }], {
    temperature: 0.3,
    tools: [{ type: "function", function: { name: "calculator" } }],
  });
  assert.equal(out.content, "hello");
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, "calculator");
  assert.deepEqual(out.toolCalls[0].arguments, { expr: "1+1" });
  assert.equal(out.usage.promptTokens, 11);
  assert.equal(out.usage.completionTokens, 7);
  // provider received the pass-through args
  assert.equal(p.calls[0].temperature, 0.3);
  assert.equal(p.calls[0].tools.length, 1);
  assert.equal(llm.model, "grok-test");
});

test("adapter.chat tolerates malformed tool arguments", async () => {
  const p = fakeProvider([
    {
      message: {
        content: null,
        tool_calls: [{ id: "c1", function: { name: "x", arguments: "not-json{" } }],
      },
      usage: {},
    },
  ]);
  const out = await wrapProvider(p).chat([{ role: "user", content: "go" }]);
  assert.deepEqual(out.toolCalls[0].arguments, { _raw: "not-json{" });
});

test("structuredOutput parses fenced JSON and injects json-only system prompt", async () => {
  const p = fakeProvider([
    { message: { content: '```json\n{"plan":["a","b"]}\n```' }, usage: {} },
  ]);
  const llm = wrapProvider(p);
  const out = await llm.structuredOutput([{ role: "user", content: "plan it" }], { type: "object" }, 0.1);
  assert.deepEqual(out, { plan: ["a", "b"] });
  assert.equal(p.calls[0].messages[0].role, "system");
  assert.match(p.calls[0].messages[0].content, /ONLY with valid JSON/);
});

test("structuredOutput retries once on invalid JSON", async () => {
  const p = fakeProvider([
    { message: { content: "sorry, cannot" }, usage: {} },
    { message: { content: '{"ok":true}' }, usage: {} },
  ]);
  const out = await wrapProvider(p).structuredOutput([{ role: "user", content: "x" }], null);
  assert.deepEqual(out, { ok: true });
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1].messages.at(-1).content, /not valid JSON/);
});

test("structuredOutput validates + retries against a zod-like schema", async () => {
  const schema = {
    safeParse(v) {
      return typeof v?.n === "number"
        ? { success: true, data: v }
        : { success: false, error: { issues: [{ message: "n must be number" }] } };
    },
  };
  const p = fakeProvider([
    { message: { content: '{"n":"three"}' }, usage: {} },
    { message: { content: '{"n":3}' }, usage: {} },
  ]);
  const out = await wrapProvider(p).structuredOutput([{ role: "user", content: "x" }], schema);
  assert.deepEqual(out, { n: 3 });
});

test("extractJson finds embedded objects amid prose", () => {
  assert.deepEqual(extractJson('Here you go: {"a":[1,2],"b":"x}y"} done'), { a: [1, 2], b: "x}y" });
  assert.deepEqual(extractJson("[1,2,3]"), [1, 2, 3]);
  assert.throws(() => extractJson("no json here"));
});
