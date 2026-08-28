/**
 * Security audit checks for doctor / SECURITY.md (Phase S).
 *
 * Two of these rows used to fail open, both by grading a host against a short
 * list of literals instead of a predicate:
 *
 *  - gateway.bind matched three wildcard spellings and two loopback spellings
 *    and had no else, so every OTHER host — a LAN address, a public address,
 *    a hostname — produced NO FINDING AT ALL and left ok true. The exposure
 *    the row exists to report was the one input it could not report on.
 *    ::1 fell into the same silence, so the audit could not tell the safe
 *    case from the dangerous one either.
 *  - gateway.token chose info vs error from the same two literals, never from
 *    the profile — while the doctor's own owner.gatewayToken row grades the
 *    identical fact (prod && !token) an error. One config, two verdicts.
 *
 * Both now use isLoopbackHost, the same predicate the gateway enforces its
 * own bind safety with (src/gateway/bind-guard.mjs), so "local" means one
 * thing in this codebase rather than three.
 */
import { isLoopbackHost } from "../gateway/bind-guard.mjs";
import { DM_POSTURE, isOpenDm, dmRemedy } from "../channels/dm-posture.mjs";

export function runSecurityAudit(cfg = {}) {
  const findings = [];

  function add(id, level, message, fix = null) {
    findings.push({ id, level, message, fix });
  }

  const prod = cfg.profile === "prod" || process.env.XCLAW_PROFILE === "prod";
  const host = cfg.gateway?.host || "127.0.0.1";
  const loopback = isLoopbackHost(host);
  const wildcard = host === "0.0.0.0" || host === "::" || host === "[::]";
  if (loopback) {
    add("gateway.bind", "ok", `Gateway local bind ${host}`);
  } else {
    add(
      "gateway.bind",
      "warn",
      wildcard
        ? `Gateway binds ${host} (all interfaces)`
        : `Gateway binds ${host} (reachable from off this host)`,
      "Set gateway.host to 127.0.0.1 or put behind reverse proxy + auth"
    );
  }

  const token =
    cfg.gateway?.token ||
    cfg.gateway?.authToken ||
    process.env.XCLAW_GATEWAY_TOKEN;
  if (!token) {
    add(
      "gateway.token",
      prod || !loopback ? "error" : "info",
      prod
        ? 'profile is "prod" but no XCLAW_GATEWAY_TOKEN / gateway.token'
        : "No XCLAW_GATEWAY_TOKEN / gateway.token",
      "Export XCLAW_GATEWAY_TOKEN for any non-local or multi-user deploy"
    );
  } else {
    add("gateway.token", "ok", "Gateway token configured");
  }

  if (cfg.gateway?.protectMetrics && !token) {
    add("gateway.metrics", "warn", "protectMetrics set but no token");
  }

  if (cfg.security?.autoApprove) {
    add(
      "security.autoApprove",
      "warn",
      "autoApprove=true",
      "Use only in lab; prod should use approvalPolicy risky/safeAuto"
    );
  } else {
    add("security.autoApprove", "ok", "autoApprove off");
  }

  // systemRunPlan binding (TOCTOU mitigation on exec approvals)
  const bindPlan = cfg.security?.bindSystemRunPlan !== false;
  if (!cfg.security?.autoApprove) {
    if (bindPlan) {
      add(
        "security.systemRunPlan",
        "ok",
        "bindSystemRunPlan on (frozen argv/cwd/exe before approval)"
      );
    } else {
      add(
        "security.systemRunPlan",
        "warn",
        "bindSystemRunPlan=false — approvals are not pinned to a frozen plan",
        "Set security.bindSystemRunPlan=true (default) for TOCTOU resistance"
      );
    }
  }
  if (cfg.security?.requirePinnedExe === true) {
    add(
      "security.requirePinnedExe",
      "ok",
      "requirePinnedExe=true (fail-closed when binary cannot be realpath'd)"
    );
  }

  if (prod) {
    if (cfg.security?.autoApprove) {
      add("profile.prod", "error", "prod profile with autoApprove");
    } else {
      add("profile.prod", "ok", "prod profile without autoApprove");
    }
  }

  const sandbox = cfg.sandbox || cfg.security?.sandbox || {};
  if (sandbox.enabled === false) {
    add("sandbox", "warn", "sandbox disabled", "Enable sandbox.path escape protection");
  } else {
    add("sandbox", "ok", "sandbox enabled (default)");
  }

  const compToken =
    cfg.computer?.authToken ||
    process.env.XCLAW_COMPUTER_TOKEN ||
    process.env.XCLAW_COMPUTER_AUTH;
  if (cfg.computer?.remoteUrl && !compToken) {
    add(
      "computer.remoteAuth",
      "error",
      "remoteUrl set without computer auth token",
      "Set XCLAW_COMPUTER_TOKEN and run auth proxy"
    );
  } else if (compToken) {
    add("computer.remoteAuth", "ok", "computer auth token present");
  } else {
    add("computer.remoteAuth", "info", "local computer without auth token (ok for localhost)");
  }

  const key =
    cfg.agent?.apiKey ||
    process.env.XCLAW_API_KEY ||
    process.env.XAI_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!key) {
    add("apiKey", "warn", "no model API key in env/config");
  } else {
    add("apiKey", "ok", "model API key present");
  }

  // Channels whose senders are gated. This enumerated ["telegram","discord"]
  // and compared dmPolicy to the literal "open", so it was blind to Slack
  // twice over: Slack was absent from the list, and Slack's open state is
  // usually an ABSENT field (its default) or the "pairing" this very remedy
  // recommends, neither of which equals "open". A prod config with
  // slack:{enabled:true} produced no finding at all.
  for (const ch of Object.keys(DM_POSTURE)) {
    const c = cfg.channels?.[ch];
    if (c?.enabled && isOpenDm(ch, c)) {
      add(
        `channels.${ch}.dm`,
        "warn",
        `${ch} DM policy is open — any sender it can see may command the agent`,
        dmRemedy(ch)
      );
    }
  }

  // OAuth misconfig: client id without understanding API key path
  if (process.env.XCLAW_XAI_OAUTH_CLIENT_ID && !process.env.XAI_API_KEY) {
    add(
      "oauth.xai",
      "info",
      "XCLAW_XAI_OAUTH_CLIENT_ID set but no XAI_API_KEY — OAuth is experimental; API keys are the supported path"
    );
  }

  const errors = findings.filter((f) => f.level === "error").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  return {
    at: new Date().toISOString(),
    ok: errors === 0,
    errors,
    warnings: warns,
    findings,
  };
}
