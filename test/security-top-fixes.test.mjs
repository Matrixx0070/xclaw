import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildToolEnv, getEnvPolicyMode } from "../src/security/env-policy.mjs";
import { egressWantsNetIsolation } from "../src/security/egress.mjs";
import {
  findBwrap,
  resetBwrapCache,
  probeBwrapWorks,
  probeBwrapNetns,
  buildBwrapArgv,
} from "../src/security/os-sandbox.mjs";
import { assertBindSafety, isLoopbackHost } from "../src/gateway/bind-guard.mjs";
import { ensureGatewayToken } from "../src/cli/init.mjs";
import { executeBash } from "../src/computer/modules/bash-tool.mjs";
import { PROFILES } from "../src/config/profiles.mjs";

describe("env policy for tool spawns", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    LC_ALL: "C",
    XAI_API_KEY: "xai-secret",
    GITHUB_TOKEN: "ghp_secret",
    XCLAW_GATEWAY_TOKEN: "gw-secret",
    MY_PASSWORD: "p",
    HARMLESS: "ok",
  };

  it("strip-secrets is the default and removes credential-shaped names", () => {
    const { env, mode, stripped } = buildToolEnv({}, source);
    assert.equal(mode, "strip-secrets");
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.HARMLESS, "ok");
    assert.equal(env.XAI_API_KEY, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.XCLAW_GATEWAY_TOKEN, undefined);
    assert.equal(env.MY_PASSWORD, undefined);
    assert.ok(stripped.includes("XAI_API_KEY"));
  });

  it("allowlist keeps only base vars plus security.envAllow", () => {
    const cfg = { security: { bashEnv: "allowlist", envAllow: ["HARMLESS"] } };
    const { env, mode } = buildToolEnv(cfg, source);
    assert.equal(mode, "allowlist");
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.LC_ALL, "C");
    assert.equal(env.HARMLESS, "ok");
    assert.equal(env.XAI_API_KEY, undefined);
  });

  it("inherit passes everything; envDeny still strips", () => {
    const cfg = { security: { bashEnv: "inherit", envDeny: ["HARMLESS"] } };
    const { env } = buildToolEnv(cfg, source);
    assert.equal(env.XAI_API_KEY, "xai-secret");
    assert.equal(env.HARMLESS, undefined);
  });

  it("env override wins", () => {
    process.env.XCLAW_BASH_ENV = "inherit";
    try {
      assert.equal(getEnvPolicyMode({ security: { bashEnv: "allowlist" } }), "inherit");
    } finally {
      delete process.env.XCLAW_BASH_ENV;
    }
  });

  it("prod profile defaults bashEnv to allowlist", () => {
    assert.equal(PROFILES.prod.security.bashEnv, "allowlist");
  });
});

describe("bash tool spawn hygiene", () => {
  it("secrets are not visible inside the spawned shell", async () => {
    process.env.XCLAW_TEST_FAKE_TOKEN = "leak-me";
    const prevSandbox = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "off";
    try {
      const r = await executeBash(
        { command: "echo TOK=${XCLAW_TEST_FAKE_TOKEN:-absent}" },
        { cfg: {} }
      );
      assert.equal(r.ok, true, r.stderr);
      assert.match(r.stdout, /TOK=absent/);
      assert.equal(r.envPolicy, "strip-secrets");
    } finally {
      delete process.env.XCLAW_TEST_FAKE_TOKEN;
      if (prevSandbox == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prevSandbox;
    }
  });

  it("no-plan spawn is a non-login shell", async () => {
    const prevSandbox = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "off";
    try {
      const r = await executeBash(
        { command: "shopt -q login_shell && echo login || echo nologin" },
        { cfg: {} }
      );
      assert.equal(r.ok, true, r.stderr);
      assert.match(r.stdout, /nologin/);
    } finally {
      if (prevSandbox == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prevSandbox;
    }
  });
});

describe("egress-driven network isolation", () => {
  it("egressWantsNetIsolation follows policy mode", () => {
    assert.equal(egressWantsNetIsolation({ security: { egress: { mode: "allow" } } }), false);
    assert.equal(egressWantsNetIsolation({ security: { egress: { mode: "deny" } } }), true);
    assert.equal(
      egressWantsNetIsolation({ security: { egress: { mode: "allowlist" } } }),
      true
    );
  });

  it("bwrap argv gains --unshare-net when egress denies (or degrades honestly)", (t) => {
    resetBwrapCache();
    if (!findBwrap() || !probeBwrapWorks()) {
      t.skip("bubblewrap not usable on this host");
      return;
    }
    const cfg = { security: { egress: { mode: "deny" }, osSandbox: "bwrap" } };
    const built = buildBwrapArgv({ cfg, cwd: process.cwd() });
    assert.equal(built.ok, true);
    if (probeBwrapNetns()) {
      assert.ok(built.argvPrefix.includes("--unshare-net"));
      assert.equal(built.netIsolated, true);
      assert.equal(built.netnsDegraded, false);
    } else {
      assert.ok(!built.argvPrefix.includes("--unshare-net"));
      assert.equal(built.netIsolated, false);
      assert.equal(built.netnsDegraded, true);
    }
  });

  it("no netns when egress allows and nothing explicit", (t) => {
    resetBwrapCache();
    if (!findBwrap() || !probeBwrapWorks()) {
      t.skip("bubblewrap not usable on this host");
      return;
    }
    const cfg = { security: { egress: { mode: "allow" }, osSandbox: "bwrap" } };
    const built = buildBwrapArgv({ cfg, cwd: process.cwd() });
    assert.equal(built.ok, true);
    assert.ok(!built.argvPrefix.includes("--unshare-net"));
  });
});

describe("gateway bind guard", () => {
  it("loopback may run tokenless", () => {
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("0.0.0.0"), false);
    assert.equal(assertBindSafety({ gateway: { host: "127.0.0.1" } }).ok, true);
  });

  it("non-loopback without token is refused", () => {
    const prev = process.env.XCLAW_GATEWAY_TOKEN;
    delete process.env.XCLAW_GATEWAY_TOKEN;
    try {
      const r = assertBindSafety({ gateway: { host: "0.0.0.0" } });
      assert.equal(r.ok, false);
      assert.match(r.error, /refusing to bind/);
    } finally {
      if (prev != null) process.env.XCLAW_GATEWAY_TOKEN = prev;
    }
  });

  it("token or explicit allow-open permits non-loopback", () => {
    assert.equal(
      assertBindSafety({ gateway: { host: "0.0.0.0", token: "t" } }).ok,
      true
    );
    process.env.XCLAW_GATEWAY_ALLOW_OPEN = "1";
    try {
      assert.equal(assertBindSafety({ gateway: { host: "0.0.0.0" } }).ok, true);
    } finally {
      delete process.env.XCLAW_GATEWAY_ALLOW_OPEN;
    }
  });
});

describe("init gateway token", () => {
  it("prod generates and stores a token when none configured", () => {
    const prev = process.env.XCLAW_GATEWAY_TOKEN;
    delete process.env.XCLAW_GATEWAY_TOKEN;
    try {
      const patch = { profile: "prod" };
      const token = ensureGatewayToken("prod", {}, patch);
      assert.ok(token && token.length === 64);
      assert.equal(patch.gateway.token, token);
    } finally {
      if (prev != null) process.env.XCLAW_GATEWAY_TOKEN = prev;
    }
  });

  it("does not overwrite an existing token and skips non-prod", () => {
    const patch = {};
    assert.equal(
      ensureGatewayToken("prod", { gateway: { token: "existing" } }, patch),
      null
    );
    assert.equal(patch.gateway, undefined);
    assert.equal(ensureGatewayToken("lab", {}, patch), null);
  });
});
