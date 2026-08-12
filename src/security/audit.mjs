/**
 * Security audit checks for doctor / SECURITY.md (Phase S).
 */
export function runSecurityAudit(cfg = {}) {
  const findings = [];

  function add(id, level, message, fix = null) {
    findings.push({ id, level, message, fix });
  }

  const host = cfg.gateway?.host || "127.0.0.1";
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    add(
      "gateway.bind",
      "warn",
      `Gateway binds ${host} (all interfaces)`,
      "Set gateway.host to 127.0.0.1 or put behind reverse proxy + auth"
    );
  } else if (host === "127.0.0.1" || host === "localhost") {
    add("gateway.bind", "ok", `Gateway local bind ${host}`);
  }

  const token =
    cfg.gateway?.token ||
    cfg.gateway?.authToken ||
    process.env.XCLAW_GATEWAY_TOKEN;
  if (!token) {
    add(
      "gateway.token",
      host === "127.0.0.1" || host === "localhost" ? "info" : "error",
      "No XCLAW_GATEWAY_TOKEN / gateway.token",
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

  if (cfg.profile === "prod" || process.env.XCLAW_PROFILE === "prod") {
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

  // channels open dm
  for (const ch of ["telegram", "discord"]) {
    const c = cfg.channels?.[ch];
    if (c?.enabled && c?.dmPolicy === "open") {
      add(
        `channels.${ch}.dm`,
        "warn",
        `${ch} dmPolicy=open`,
        "Prefer pairing or allowlist"
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
