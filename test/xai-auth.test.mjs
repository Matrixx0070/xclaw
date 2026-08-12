
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loginWithApiKey,
  authStatus,
  resolveXaiToken,
  logout,
} from "../src/auth/xai.mjs";

describe("xai auth", () => {
  it("stores and resolves api key", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-auth-"));
    const cfg = { paths: { configDir: dir } };
    await loginWithApiKey(cfg, "xai-test-key");
    const st = await authStatus(cfg);
    assert.equal(st.hasToken, true);
    assert.equal(st.hasStoredApiKey, true);
    const r = await resolveXaiToken(cfg);
    assert.equal(r.token, "xai-test-key");
    await logout(cfg);
  });
  it("oauth login fails without client id", async () => {
    const { loginWithOAuth } = await import("../src/auth/xai.mjs");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-auth2-"));
    await assert.rejects(
      () => loginWithOAuth({ paths: { configDir: dir } }),
      /XCLAW_XAI_OAUTH_CLIENT_ID/
    );
  });
});
