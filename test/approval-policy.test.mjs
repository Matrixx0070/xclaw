import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import { createApprovalGate } from "../src/security/approvals.mjs";
import { applyProfile } from "../src/config/profiles.mjs";
import { DEFAULT_CONFIG } from "../src/config/defaults.mjs";

function deepMerge(base, over) {
  if (!over || typeof over !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** Mimic fixed load order: DEFAULT → profile → user */
function mergeLikeLoad(user) {
  const profileName = user.profile || "dev";
  let cfg = deepMerge(structuredClone(DEFAULT_CONFIG), { profile: profileName });
  cfg = applyProfile(cfg);
  cfg = deepMerge(cfg, user);
  return cfg;
}

describe("approval policies", () => {
  it("needsApproval false when autoApprove", async () => {
    const gate = createApprovalGate({ security: { autoApprove: true } });
    const r = await gate.authorize("xclaw_bash", { command: "echo hi" });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "auto");
  });

  it("needsApproval false when policy never", async () => {
    const gate = createApprovalGate({ security: { approvalPolicy: "never" } });
    const r = await gate.authorize("bash", { command: "ls" });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "auto");
  });

  it("safeAuto tools skip approval under risky", async () => {
    const gate = createApprovalGate({
      security: { autoApprove: false, approvalPolicy: "risky" },
    });
    const r = await gate.authorize("xclaw_file_read", { path: "/tmp/x" });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "auto");
  });

  it("bash requires approval under risky without auto", async () => {
    const gate = createApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash", "xclaw_bash"],
        approvalSlaMs: 50,
        approvalSlaAction: "deny",
        approvalTimeoutMs: 80,
      },
    });
    const r = await gate.authorize("bash", { command: "id" }, { timeoutMs: 80 });
    assert.equal(r.ok, false);
    assert.ok(["timeout", "sla_timeout"].includes(r.reason));
  });

  it("user security wins over dev profile", () => {
    const cfg = mergeLikeLoad({
      profile: "dev",
      security: { autoApprove: true, approvalPolicy: "never" },
    });
    assert.equal(cfg.security.autoApprove, true);
    assert.equal(cfg.security.approvalPolicy, "never");
  });

  it("lab profile enables autoApprove when user silent", () => {
    const cfg = mergeLikeLoad({ profile: "lab" });
    assert.equal(cfg.security.autoApprove, true);
    assert.equal(cfg.security.approvalPolicy, "never");
  });
});
