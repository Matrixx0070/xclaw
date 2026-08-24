/**
 * swarm-ext data plugins — CI-safe tests. Every tool takes { fetchImpl }; no
 * network. Verifies the REAL implementations' response mapping, client-side
 * filtering, fallbacks, and error shapes (these replaced vendor stubs that
 * fabricated data — the tests exist to keep them honest).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { YahooFinanceTool } from "../src/swarm/plugins/yahoo-finance/tool.mjs";
import { SecEdgarTool } from "../src/swarm/plugins/sec-edgar/tool.mjs";
import { WorldBankTool } from "../src/swarm/plugins/world-bank/tool.mjs";
import { ImfTool } from "../src/swarm/plugins/imf/tool.mjs";
import { ScholarTool } from "../src/swarm/plugins/scholar/tool.mjs";
import { AudioGenerationTool } from "../src/swarm/plugins/audio-generation/tool.mjs";
import { makeHttp, capList } from "../src/swarm/plugins-lib/http.mjs";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const jsonRes = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] },
  text: async () => JSON.stringify(body),
});

function fetchScript(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    for (const [re, resp] of routes) {
      if (re.test(String(url))) return typeof resp === "function" ? resp(url) : resp;
    }
    throw new Error(`unrouted fetch: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

test("yahoo_finance quote maps chart meta to real fields", async () => {
  const f = fetchScript([
    [/query1\.finance\.yahoo\.com/, jsonRes({
      chart: { result: [{ meta: { symbol: "AAPL", longName: "Apple Inc.", currency: "USD", regularMarketPrice: 309.35, chartPreviousClose: 311.3, regularMarketVolume: 42 } }] },
    })],
  ]);
  const t = new YahooFinanceTool({ fetchImpl: f });
  const out = await t.execute({ symbol: "aapl" });
  assert.equal(out.success, true);
  assert.equal(out.data.price, 309.35);
  assert.equal(out.data.name, "Apple Inc.");
  assert.match(f.calls[0], /range=1d/, "quote uses 1d range");
});

test("yahoo_finance rejects garbage symbols before any fetch", async () => {
  const f = fetchScript([]);
  const t = new YahooFinanceTool({ fetchImpl: f });
  const out = await t.execute({ symbol: "not a symbol; rm -rf" });
  assert.equal(out.success, false);
  assert.equal(f.calls.length, 0);
});

test("yahoo_finance history caps bars and reports true total", async () => {
  const ts = Array.from({ length: 200 }, (_, i) => 1700000000 + i * 86400);
  const mk = (v) => Array.from({ length: 200 }, () => v);
  const f = fetchScript([
    [/chart\/TSLA/, jsonRes({ chart: { result: [{ meta: {}, timestamp: ts, indicators: { quote: [{ open: mk(1), high: mk(2), low: mk(0.5), close: mk(1.5), volume: mk(10) }] } }] } })],
  ]);
  const out = await new YahooFinanceTool({ fetchImpl: f }).execute({ symbol: "TSLA", data_type: "history", period: "1y" });
  assert.equal(out.success, true);
  assert.equal(out.data.bars.length, 120, "bars capped for LLM context");
  assert.equal(out.data.total, 200);
});

test("sec_edgar resolves ticker via index and filters filings by form", async () => {
  const f = fetchScript([
    [/company_tickers\.json/, jsonRes({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } })],
    [/data\.sec\.gov\/submissions\/CIK0000320193/, jsonRes({
      name: "Apple Inc.",
      filings: { recent: {
        form: ["8-K", "10-K", "10-Q"],
        accessionNumber: ["0001-24-1", "0001-24-2", "0001-24-3"],
        filingDate: ["2025-11-01", "2025-10-31", "2025-08-01"],
        primaryDocument: ["a.htm", "b.htm", "c.htm"],
      } },
    })],
  ]);
  const out = await new SecEdgarTool({ fetchImpl: f }).execute({ ticker: "AAPL", filing_type: "10-K" });
  assert.equal(out.success, true);
  assert.equal(out.data.filings.length, 1);
  assert.equal(out.data.filings[0].form, "10-K");
  assert.match(out.data.filings[0].url, /Archives\/edgar\/data\/320193/);
});

test("sec_edgar falls back to built-in CIK map when the ticker index is unreachable", async () => {
  const f = fetchScript([
    [/company_tickers\.json/, () => { throw new Error("HTTP 403"); }],
    [/data\.sec\.gov\/submissions\/CIK0001045810/, jsonRes({ name: "NVIDIA CORP", filings: { recent: { form: [], accessionNumber: [], filingDate: [], primaryDocument: [] } } })],
  ]);
  const out = await new SecEdgarTool({ fetchImpl: f }).execute({ ticker: "NVDA" });
  assert.equal(out.success, true, out.error);
  assert.equal(out.data.entityName, "NVIDIA CORP");
});

test("sec_edgar unknown ticker + unreachable index returns actionable error, not fake data", async () => {
  const f = fetchScript([[/company_tickers\.json/, () => { throw new Error("HTTP 403"); }]]);
  const out = await new SecEdgarTool({ fetchImpl: f }).execute({ ticker: "ZZZZZ" });
  assert.equal(out.success, false);
  assert.match(out.error, /numeric CIK/);
});

test("world_bank maps v2 payload and drops null observations", async () => {
  const f = fetchScript([
    [/api\.worldbank\.org/, jsonRes([{ page: 1 }, [
      { country: { value: "Germany" }, date: "2023", value: 5.9, indicator: { value: "Inflation" } },
      { country: { value: "Germany" }, date: "2024", value: null, indicator: { value: "Inflation" } },
    ]])],
  ]);
  const out = await new WorldBankTool({ fetchImpl: f }).execute({ country: "DEU", indicator: "inflation" });
  assert.equal(out.success, true);
  assert.equal(out.data.points.length, 1);
  assert.equal(out.data.indicator, "FP.CPI.TOTL.ZG", "shortcut expanded to real code");
});

test("imf filters the all-countries/all-years payload down to the request", async () => {
  const f = fetchScript([
    [/imf\.org\/external\/datamapper/, jsonRes({ values: { NGDP_RPCH: {
      USA: { 1980: -0.3, 2024: 2.8, 2025: 2.1 },
      SDN: { 2024: 1.0 },
    } } })],
  ]);
  const out = await new ImfTool({ fetchImpl: f }).execute({ country: "USA", indicator: "gdp_growth", start_year: 2024, end_year: 2025 });
  assert.equal(out.success, true);
  assert.deepEqual(Object.keys(out.data.series), ["USA"], "unrequested countries dropped");
  assert.deepEqual(out.data.series.USA.map((r) => r.year), ["2024", "2025"], "years outside range dropped");
});

test("scholar falls back to OpenAlex when Semantic Scholar is rate-limited", async () => {
  const f = fetchScript([
    [/semanticscholar\.org/, jsonRes({ message: "Too Many Requests" }, { status: 429 })],
    [/api\.openalex\.org/, jsonRes({ meta: { count: 1 }, results: [{
      title: "A survey on agents", publication_year: 2024, cited_by_count: 1437,
      authorships: [{ author: { display_name: "L. Wang" } }],
      doi: "https://doi.org/10.1234/x", abstract_inverted_index: { Agents: [0], are: [1], cool: [2] },
    }] })],
  ]);
  const out = await new ScholarTool({ fetchImpl: f }).execute({ query: "agents", limit: 1 });
  assert.equal(out.success, true, out.error);
  assert.match(out.data.source, /OpenAlex/);
  assert.equal(out.data.papers[0].abstract, "Agents are cool");
  assert.equal(out.data.papers[0].doi, "10.1234/x");
});

test("http helper retries once on 429 honoring Retry-After", async () => {
  let n = 0;
  const get = makeHttp(async () => {
    n++;
    return n === 1
      ? jsonRes({ err: 1 }, { status: 429, headers: { "retry-after": "0" } })
      : jsonRes({ ok: 1 });
  });
  const out = await get("https://x.example/api");
  assert.deepEqual(out, { ok: 1 });
  assert.equal(n, 2);
});

test("capList bounds arrays", () => {
  assert.equal(capList([1, 2, 3], 2).length, 2);
  assert.equal(capList([1], 5).length, 1);
});

test("audio_generation synthesizes via injected speak and moves file into workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-audio-"));
  const src = join(dir, "tmp-tts.wav");
  writeFileSync(src, Buffer.from("RIFFfakewavdata"));
  const t = new AudioGenerationTool({
    speakImpl: async (text) => ({ ok: true, path: src, provider: "piper" }),
    cfgLoader: async () => ({}),
    outDir: join(dir, "out"),
  });
  const out = await t.execute({ text: "hello world", filename: "greet" });
  assert.equal(out.success, true, out.error);
  assert.equal(out.data.provider, "piper");
  assert.ok(out.data.path.endsWith("greet.wav"));
  assert.ok(existsSync(out.data.path), "wav must exist in workspace");
});

test("audio_generation surfaces backend failure typed — never fabricates audio", async () => {
  const t = new AudioGenerationTool({
    speakImpl: async () => ({ ok: false, error: "No local TTS", provider: "none" }),
    cfgLoader: async () => ({}),
    outDir: mkdtempSync(join(tmpdir(), "swarm-audio-")),
  });
  const out = await t.execute({ text: "hi" });
  assert.equal(out.success, false);
  assert.match(out.error, /No local TTS/);
});

test("audio_generation rejects empty and over-length text before spawning", async () => {
  let called = 0;
  const t = new AudioGenerationTool({
    speakImpl: async () => { called++; return { ok: true }; },
    cfgLoader: async () => ({}),
    outDir: mkdtempSync(join(tmpdir(), "swarm-audio-")),
  });
  assert.equal((await t.execute({ text: "" })).success, false);
  assert.equal((await t.execute({ text: "x".repeat(501) })).success, false);
  assert.equal(called, 0);
});
