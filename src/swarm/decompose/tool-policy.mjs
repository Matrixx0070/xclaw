/**
 * Tool Policy — Enforces egress rules, approval requirements, rate limits
 * Maps to XClaw's egress/approval system
 */
import { getConfig } from "./config.mjs";

export class ToolPolicy {
  constructor(sessionConfig = {}) {
    this.egress = sessionConfig.egress || "allow";
    this.autoApprove = sessionConfig.autoApprove !== false;
    this.allowlist = sessionConfig.allowlist || [];
    this.blocklist = sessionConfig.blocklist || [];
    this.rateLimits = new Map();
  }

  canExecute(toolName, params = {}) {
    // Check blocklist
    if (this.blocklist.includes(toolName)) {
      return { allowed: false, reason: "tool_blocked" };
    }

    // Check allowlist (if in allowlist mode)
    if (this.egress === "allowlist" && !this.allowlist.includes(toolName)) {
      return { allowed: false, reason: "not_in_allowlist" };
    }

    // Check egress for network tools
    if (this.egress === "deny") {
      const networkTools = ["web_search", "browser", "web_extract", "web_crawl"];
      if (networkTools.includes(toolName)) {
        return { allowed: false, reason: "egress_denied" };
      }
    }

    // Check URL allowlist for URL-bearing tools (browser, and web_fetch
    // since the ADR 0004 bridge wiring — the check applies to any tool that
    // passes a `url` param).
    // Exact-host or dot-suffix match ONLY — the vendored substring match
    // (hostname.includes(entry)) let "allowed.com.attacker.io" through
    // (2026-08-24 security review).
    if (params.url) {
      const url = new URL(params.url);
      const hostAllowed = (a) => {
        const entry = String(a).toLowerCase().replace(/^\.+/, "");
        const host = url.hostname.toLowerCase();
        return host === entry || host.endsWith("." + entry);
      };
      if (this.allowlist.length > 0 && !this.allowlist.some(hostAllowed)) {
        return { allowed: false, reason: "url_not_allowed" };
      }
    }

    return { allowed: true };
  }

  requiresApproval(toolName, params = {}) {
    if (this.autoApprove) return false;

    // Always require approval for destructive operations
    const destructive = ["code_executor", "file_writer", "bash"];
    if (destructive.includes(toolName)) return true;

    // Require approval for network egress if not auto-approved
    if (!this.autoApprove && ["web_search", "browser"].includes(toolName)) {
      return true;
    }

    return false;
  }

  checkRateLimit(toolName, maxCalls = 100, windowMs = 60000) {
    const now = Date.now();
    const key = `tool:${toolName}`;
    const record = this.rateLimits.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count++;
    this.rateLimits.set(key, record);

    if (record.count > maxCalls) {
      return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
    }

    return { allowed: true, remaining: maxCalls - record.count };
  }
}
