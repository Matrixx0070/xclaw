import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bindRole,
  resolveRole,
  unbindRole,
} from "../src/browser/role-binding.mjs";
import {
  assertJsCodeAllowed,
  looksLikeMotorJs,
  jscodeMode,
} from "../src/browser/jscode-policy.mjs";
import { beforeInput, beforeNavigate } from "../src/browser/hooks.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

describe("A7 bypass closure", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-a7-"));
    process.env.XCLAW_FABRIC_DIR = tmp;
    process.env.XCLAW_FABRIC_ENFORCE = "1";
    delete process.env.XCLAW_ROLE_FROM_ENV;
    delete process.env.XCLAW_AGENT_ROLE;
    delete process.env.XCLAW_JSCODE_MODE;
  });
  after(async () => {
    delete process.env.XCLAW_FABRIC_DIR;
    delete process.env.XCLAW_FABRIC_ENFORCE;
    delete process.env.XCLAW_ROLE_FROM_ENV;
    delete process.env.XCLAW_AGENT_ROLE;
    delete process.env.XCLAW_JSCODE_MODE;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("looksLikeMotorJs detects click", () => {
    assert.equal(looksLikeMotorJs("document.querySelector('a').click()"), true);
    assert.equal(looksLikeMotorJs("return document.title"), false);
  });

  it("assertJsCodeAllowed blocks motor patterns under enforce", () => {
    const r = assertJsCodeAllowed("el.click()");
    assert.equal(r.ok, false);
    assert.equal(r.code, "JSCODE_MOTOR_PATTERN");
  });

  it("assertJsCodeAllowed allows read js under enforce", () => {
    const r = assertJsCodeAllowed("return { title: document.title }");
    assert.equal(r.ok, true);
  });

  it("strict mode without bind defaults to observer", async () => {
    const r = await resolveRole({ sessionId: "no-bind-yet" });
    assert.equal(r.role, "observer");
    assert.equal(r.source, "strict_default");
  });

  it("bindRole then resolveRole returns actor", async () => {
    await bindRole("sess-1", "actor");
    const r = await resolveRole({ sessionId: "sess-1" });
    assert.equal(r.role, "actor");
    assert.equal(r.source, "session_bind");
    await unbindRole("sess-1");
  });

  it("env role ignored under strict without ROLE_FROM_ENV", async () => {
    process.env.XCLAW_AGENT_ROLE = "critic";
    const r = await resolveRole({ sessionId: "env-test" });
    assert.equal(r.role, "observer"); // strict default
    delete process.env.XCLAW_AGENT_ROLE;
  });

  it("beforeInput blocks jsCode click under enforce", async () => {
    await bindRole("s2", "actor");
    const r = await beforeInput({
      sessionId: "s2",
      agentId: "s2",
      action: "evaluate",
      jsCode: "document.body.click()",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "JSCODE_MOTOR_PATTERN");
    await unbindRole("s2");
  });

  it("beforeInput allows read jsCode for bound actor", async () => {
    await bindRole("s3", "actor");
    const r = await beforeInput({
      sessionId: "s3",
      agentId: "s3",
      action: "evaluate",
      jsCode: "return document.title",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    await unbindRole("s3");
  });

  it("session_role tool registered", () => {
    const names = createBrowserTools({}).map((t) => t.name);
    assert.ok(names.includes("session_role"));
  });
});
