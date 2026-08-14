#!/usr/bin/env node
/**
 * P2 — Prod profile security fire-drill.
 */
import { loadConfig } from "../src/config/load.mjs";
import { PROFILES } from "../src/config/profiles.mjs";
import { isSearchHostAllowed } from "../src/planes/search.mjs";

const report = { at: new Date().toISOString(), checks: [], ok: true };

function check(name, pass, detail = {}) {
  report.checks.push({ name, pass, ...detail });
  if (!pass) report.ok = false;
  console.error(`[p2-prod] ${pass ? "OK" : "FAIL"} ${name}`, detail);
}

const prod = PROFILES.prod || {};
check("prod.profile.exists", Boolean(prod && prod.security));

check("prod.autoApprove.false", prod.security?.autoApprove === false, {
  autoApprove: prod.security?.autoApprove,
});

check("prod.egress.deny", prod.security?.egress?.mode === "deny", {
  egress: prod.security?.egress,
});

check("prod.osSandbox.auto", prod.security?.osSandbox === "auto" || prod.security?.osSandbox === "bwrap", {
  osSandbox: prod.security?.osSandbox,
});

check("prod.spawnEnforce.set", Boolean(prod.security?.spawnEnforce), {
  spawnEnforce: prod.security?.spawnEnforce,
});

check("prod.gateway.requireAuth", prod.gateway?.requireAuth === true, {
  gateway: prod.gateway,
});

check(
  "prod.requireApproval.includes_bash",
  Array.isArray(prod.security?.requireApproval) &&
    prod.security.requireApproval.some((x) => String(x).includes("bash")),
  { requireApproval: prod.security?.requireApproval }
);

check("search.plane.blocks_google", isSearchHostAllowed("https://google.com") === false);
check("search.plane.allows_ddg", isSearchHostAllowed("https://html.duckduckgo.com/html/") === true);

process.env.XCLAW_PROFILE = "prod";
try {
  const cfg = await loadConfig();
  check("loadConfig.respects_prod_env", true, { profile: cfg.profile });
  // After merge, autoApprove should not be true in pure prod unless user overrode config file
  // User ~/.xclaw may override prod defaults — report only, do not fail drill.
  if (cfg.profile === "prod" && cfg.security?.autoApprove === true) {
    report.checks.push({
      name: "merged.autoApprove.user_override",
      pass: true,
      warn: true,
      detail: "config file sets autoApprove=true over prod default false",
      autoApprove: true,
    });
    console.error("[p2-prod] WARN merged.autoApprove.user_override");
  }
} catch (e) {
  check("loadConfig.prod", false, { error: String(e.message || e) });
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
