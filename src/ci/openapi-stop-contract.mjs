/**
 * Ship-blocker: OpenAPI /stop contract must include dryRun.
 */
import fs from "node:fs";
import path from "node:path";

export function checkOpenapiStopContract(root = process.cwd()) {
  const fp = path.join(root, "docs/openapi-stop.yaml");
  if (!fs.existsSync(fp)) {
    return { ok: false, error: "missing docs/openapi-stop.yaml" };
  }
  const yaml = fs.readFileSync(fp, "utf8");
  const missing = [];
  if (!yaml.includes("dryRun")) missing.push("dryRun");
  if (!yaml.includes("x-dry-run-response")) missing.push("x-dry-run-response");
  if (!yaml.includes("/stop")) missing.push("/stop");
  if (!/X-XClaw-Stop-Sig/.test(yaml)) missing.push("X-XClaw-Stop-Sig");
  if (!yaml.includes("bashBg")) missing.push("bashBg");
  return {
    ok: missing.length === 0,
    missing,
    path: fp,
  };
}

export default { checkOpenapiStopContract };
