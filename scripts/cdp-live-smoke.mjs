#!/usr/bin/env node
/**
 * Live CDP smoke: requires Chrome with --remote-debugging-port=9222
 *   export XCLAW_CDP_URL=http://127.0.0.1:9222
 *   node scripts/cdp-live-smoke.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";

const endpoint = process.env.XCLAW_CDP_URL || process.env.CDP_URL || "http://127.0.0.1:9222";
process.env.XCLAW_CDP_URL = endpoint;
const u = new URL(endpoint);

function req(method, pth) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: u.hostname, port: u.port || 9222, path: pth, method },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      }
    );
    r.on("error", reject);
    r.end();
  });
}

const version = await req("GET", "/json/version");
if (version.status !== 200) {
  console.error("CDP not reachable at", endpoint, version.body);
  process.exit(2);
}

await req("PUT", "/json/new?" + encodeURIComponent("https://example.com/"));
await new Promise((r) => setTimeout(r, 2000));

const list = JSON.parse((await req("GET", "/json/list")).body);
const pages = list.filter((t) => t.type === "page").map((t) => t.url);

const screenshot = await runComputerAct({ action: "screenshot", urlMatch: "example.com" });
const click = await runComputerAct({ action: "click", x: 400, y: 280, urlMatch: "example.com" });
const key = await runComputerAct({ action: "key", key: "Tab", urlMatch: "example.com" });

const report = {
  at: new Date().toISOString(),
  cdp: endpoint,
  pages,
  results: {
    screenshot: { ok: !!screenshot.ok, pageUrl: screenshot.pageUrl, engine: screenshot.engine, bytes: screenshot.bytes },
    click: { ok: !!click.ok, pageUrl: click.pageUrl, engine: click.engine },
    key: { ok: !!key.ok, engine: key.engine },
  },
  livePass: !!(screenshot.ok && click.ok && key.ok),
};

const outDir = path.join(process.cwd(), "reports/autonomy");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "cdp-live-smoke.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.livePass ? 0 : 1);
