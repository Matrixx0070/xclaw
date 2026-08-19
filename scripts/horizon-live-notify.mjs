#!/usr/bin/env node
import fs from "node:fs";
import { notifyLiveReport } from "../src/eval/horizon-live-notify.mjs";

const fp = process.argv[2];
import { existsSync, readFileSync } from "node:fs";
if (!fp || !existsSync(fp)) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "no_file" }));
  process.exit(0);
}
const report = JSON.parse(readFileSync(fp, "utf8"));
const r = await notifyLiveReport(report.liveReport || report);
console.log(JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
