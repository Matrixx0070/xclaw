/**
 * Network egress policy for tool execution.
 *
 * Philosophy: nothing critical leaves the machine unless deliberately allowed.
 * Default for prod profile: deny outbound network patterns in shell commands.
 * Lab profile: allow (autoApprove environment).
 *
 * Config:
 *   security.egress.mode: "allow" | "deny" | "allowlist"
 *   security.egress.allowHosts: ["api.x.ai", "github.com"]
 *   security.egress.denyCommands: extra regex strings
 * Env overrides:
 *   XCLAW_EGRESS=allow|deny|allowlist
 */

const NET_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b|\bnetcat\b/i,
  /\bnmap\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bsftp\b/i,
  /\bftp\b/i,
  /\btelnet\b/i,
  /\bopenssl\s+s_client\b/i,
  /\bpython[0-9.]*\s+[^\n]*urllib/i,
  /\bnode\s+[^\n]*https?:\/\//i,
  /\bpip[0-9.]*\s+install\b/i,
  /\bnpm\s+(install|publish|exec)\b/i,
  /\bgit\s+(push|pull|fetch|clone)\b/i,
  /https?:\/\//i,
];

/**
 * @param {object} cfg
 * @returns {{ mode: string, allowHosts: string[], denyExtra: RegExp[] }}
 */
export function getEgressPolicy(cfg = {}) {
  const eg = cfg?.security?.egress || cfg?.egress || {};
  const envMode = process.env.XCLAW_EGRESS;
  let mode = String(envMode || eg.mode || "").toLowerCase();
  if (!mode) {
    // prod default deny; lab/default allow
    const profile = process.env.XCLAW_PROFILE || cfg?.profile || "lab";
    mode = profile === "prod" ? "deny" : "allow";
  }
  if (!["allow", "deny", "allowlist"].includes(mode)) mode = "allow";
  const allowHosts = (eg.allowHosts || []).map((h) => String(h).toLowerCase());
  const denyExtra = (eg.denyCommands || [])
    .map((s) => {
      try {
        return new RegExp(s, "i");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { mode, allowHosts, denyExtra };
}

function extractHosts(command) {
  const hosts = [];
  const re = /https?:\/\/([^/\s:]+)/gi;
  let m;
  while ((m = re.exec(command))) {
    hosts.push(m[1].toLowerCase());
  }
  // host-like after curl/wget -H not needed
  return hosts;
}

/**
 * Check a shell command against egress policy.
 * @returns {{ ok: true } | { ok: false, error: string, policy: object }}
 */
export function checkShellEgress(cfg, command) {
  const policy = getEgressPolicy(cfg);
  if (policy.mode === "allow") return { ok: true, policy };

  const cmd = String(command || "");
  const hits = [];
  for (const re of NET_PATTERNS) {
    if (re.test(cmd)) hits.push(re.source);
  }
  for (const re of policy.denyExtra) {
    if (re.test(cmd)) hits.push(re.source);
  }

  if (hits.length === 0) return { ok: true, policy };

  if (policy.mode === "deny") {
    return {
      ok: false,
      error: `egress denied: network-capable command blocked (mode=deny). Hits: ${hits.slice(0, 3).join(", ")}. Set security.egress.mode=allow or allowlist hosts.`,
      policy: { ...policy, hits, decision: "deny" },
    };
  }

  // allowlist mode: only permit if every host in command is allowlisted
  const hosts = extractHosts(cmd);
  if (hosts.length === 0) {
    // network tool without explicit URL still blocked in allowlist mode
    return {
      ok: false,
      error: `egress denied: network tool without allowlisted host (mode=allowlist). Hits: ${hits.slice(0, 3).join(", ")}`,
      policy: { ...policy, hits, decision: "deny" },
    };
  }
  const bad = hosts.filter((h) => !policy.allowHosts.some((a) => h === a || h.endsWith("." + a)));
  if (bad.length) {
    return {
      ok: false,
      error: `egress denied: host not on allowlist: ${bad.join(", ")}. allowHosts=${policy.allowHosts.join(",") || "(empty)"}`,
      policy: { ...policy, hits, hosts, decision: "deny" },
    };
  }
  return { ok: true, policy: { ...policy, hits, hosts, decision: "allow" } };
}

/**
 * True when the egress policy calls for OS-level network isolation of tool
 * spawns (bwrap --unshare-net). The command-pattern screen above is a fast
 * UX pre-check only — the network namespace is the actual boundary.
 * @param {object} [cfg]
 */
export function egressWantsNetIsolation(cfg = {}) {
  return getEgressPolicy(cfg).mode !== "allow";
}

/**
 * Guard tool call — currently bash/shell focused.
 */
export function guardToolEgress(cfg, toolName, args = {}) {
  const n = String(toolName || "");
  if (!/bash|shell|exec|system/i.test(n)) {
    return { ok: true };
  }
  const command = args.command || args.cmd || args.script || "";
  if (!command) return { ok: true };
  return checkShellEgress(cfg, command);
}

export default { getEgressPolicy, checkShellEgress, guardToolEgress, egressWantsNetIsolation };
