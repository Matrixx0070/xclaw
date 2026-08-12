import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  isChatModelId,
  fetchLiveModels,
  listModelsRich,
  clearModelCache,
  refreshModelCache,
} from "../src/providers/discovery.mjs";

describe("live discovery", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-disc-"));
    cfg = { paths: { configDir: dir } };
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("filters non-chat model ids", () => {
    assert.equal(isChatModelId("gpt-5.4"), true);
    assert.equal(isChatModelId("grok-4.5"), true);
    assert.equal(isChatModelId("text-embedding-3-small"), false);
    assert.equal(isChatModelId("whisper-1"), false);
    assert.equal(isChatModelId("dall-e-3"), false);
    assert.equal(isChatModelId("tts-1"), false);
  });

  it("static listModelsRich without live", async () => {
    const r = await listModelsRich(cfg, "xai", { live: false });
    assert.equal(r.source, "static");
    assert.ok(r.models.length >= 5);
  });

  it("live discovery soft-fails without key/network", async () => {
    const r = await fetchLiveModels(cfg, "openai", { timeoutMs: 2000, force: true });
    // may fail offline - ok is false or stale
    assert.ok("ok" in r);
    assert.ok(Array.isArray(r.models));
  });

  it("clear cache works", async () => {
    const c = await clearModelCache(cfg);
    assert.equal(c.ok, true);
  });

  it("merge marks static rows", async () => {
    const r = await listModelsRich(cfg, "xai", { live: true, force: true, ttlMs: 1 });
    assert.ok(r.models.some((m) => m.ref?.startsWith("xai/")));
    assert.ok(r.discovery);
  });
});

describe("anthropic discovery auth headers", () => {
  it("OAuth token → Bearer + oauth beta, no x-api-key", async () => {
    const { buildDiscoveryRequest } = await import("../src/providers/discovery.mjs");
    const req = buildDiscoveryRequest("anthropic", "https://api.anthropic.com/v1", "sk-ant-oat01-XXX");
    assert.equal(req.headers.Authorization, "Bearer sk-ant-oat01-XXX");
    assert.ok(req.headers["anthropic-beta"], "oauth beta header required");
    assert.equal(req.headers["x-api-key"], undefined, "OAuth must not send x-api-key");
    assert.match(req.url, /\/v1\/models$/);
  });

  it("plain API key → x-api-key, no oauth beta", async () => {
    const { buildDiscoveryRequest } = await import("../src/providers/discovery.mjs");
    const req = buildDiscoveryRequest("anthropic", "https://api.anthropic.com/v1", "sk-ant-api03-YYY");
    assert.equal(req.headers["x-api-key"], "sk-ant-api03-YYY");
    assert.equal(req.headers.Authorization, undefined);
    assert.equal(req.headers["anthropic-beta"], undefined);
  });
});
