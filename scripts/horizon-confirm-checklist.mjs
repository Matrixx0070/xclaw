#!/usr/bin/env node
/**
 * Confirm-live checklist — one command for steps 1–6.
 * Usage:
 *   node scripts/horizon-confirm-checklist.mjs
 *   node scripts/horizon-confirm-checklist.mjs --spend   # requires XCLAW_SOAK_CONFIRM=1
 */
import { runConfirmChecklist } from "../src/eval/horizon-confirm-checklist.mjs";

const spend = process.argv.includes("--spend");
const result = await runConfirmChecklist({ spend });
console.log(JSON.stringify(result, null, 2));
process.exit(result.exitCode ?? (result.ok ? 0 : 1));
