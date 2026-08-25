/**
 * publicUi:false against a REAL gateway.
 *
 * The companion unit tests assert what gateway/auth.mjs decides. They cannot
 * catch the defect that actually shipped, because the defect WAS the auth list:
 * it disagreed with the router about where the webchat page lives, and a test
 * of the list agrees with the list by construction. Only serving a real request
 * shows that GET /chat returns the page while GET /chat/ returns 401.
 *
 * Reproduced here before the fix, on this harness:
 *   200 OPEN /            HTML      <- the page, no credentials
 *   200 OPEN /chat        HTML      <- the page, no credentials
 *   401 DENY /chat/                 <- the one path the list knew about
 *   401 DENY /control
 *
 * Every refusal has a mirror that changes only the Authorization header: a gate
 * that 401s the UI unconditionally would satisfy the first half alone while
 * making the lockdown useless to the operator who has the token.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "u".repeat(64);
const BOOT_TIMEOUT_MS = 60_000;

let home;
let child;
let childLog = "";
let gwPort;
/** Artifact the gateway will list and serve. Created here so the test does not
 *  depend on whatever happens to sit in the checkout — a fresh CI clone has no
 *  artifacts at all, which made an earlier version of this file pass locally
 *  and fail on the runner. */
const ARTIFACT_REL = "artifacts/leak-probe.txt";
const ARTIFACT_BODY = "workspace bytes that must not leave without a token\n";

function request(p, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: gwPort, path: p, method: "GET", timeout: 10_000, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: String(e.message) }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: "timeout" });
    });
    req.end();
  });
}

const withToken = { authorization: `Bearer ${TOKEN}` };

/** The paths the gateway serves a UI page at. Each must be behind the gate. */
const UI_PATHS = ["/", "/chat", "/chat/", "/chat/app.js", "/control", "/control/", "/artifacts"];

before(async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  gwPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  home = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-publicui-"));
  fs.mkdirSync(path.join(home, ".xclaw"), { recursive: true });

  const workspace = path.join(home, "workspace");
  const artifact = path.join(workspace, ARTIFACT_REL);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, ARTIFACT_BODY);

  fs.writeFileSync(
    path.join(home, ".xclaw", "xclaw.json"),
    JSON.stringify(
      {
        profile: "lab",
        // The operator's lockdown, with webchat ON — the configuration in which
        // the bare-path hole was reachable.
        gateway: { host: "127.0.0.1", port: gwPort, token: TOKEN, publicUi: false },
        computer: { autoStart: false },
        channels: { telegram: { enabled: false }, webchat: { enabled: true } },
        tokens: { probeOnStart: false },
        // Both /artifacts routes resolve against this, so the listing and the
        // download are the one file written above.
        agent: { workingDir: workspace },
      },
      null,
      2
    )
  );

  child = spawn(process.execPath, ["bin/xclaw.mjs", "gateway"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      XCLAW_HOME: home,
      XCLAW_PROFILE: "lab",
      XAI_API_KEY: "xai-test-dummy",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (childLog += d));
  child.stderr.on("data", (d) => (childLog += d));

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let up = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if ((await request("/health")).status === 200) {
      up = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(up, `gateway never became healthy on :${gwPort}\n${childLog.slice(-2000)}`);
});

after(async () => {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    child.kill("SIGKILL");
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

describe("publicUi:false on a live gateway", () => {
  for (const p of UI_PATHS) {
    it(`refuses ${p} without a token`, async () => {
      const r = await request(p);

      assert.equal(
        r.status,
        401,
        `${p} served without credentials on a locked-down gateway (${r.status}: ${r.body.slice(0, 120)})`
      );
    });
  }

  for (const p of UI_PATHS) {
    it(`serves ${p} to the operator`, async () => {
      const r = await request(p, withToken);

      assert.notEqual(r.status, 401, `${p} unreachable WITH the token (${r.body.slice(0, 120)})`);
    });
  }

  it("keeps /health open", async () => {
    // Proves the 401s above are the gate deciding, not the gateway refusing
    // everything — and that locking the UI does not take liveness with it.
    const r = await request("/health");

    assert.equal(r.status, 200);
  });

  it("still refuses the artifacts listing without a token", async () => {
    const r = await request("/artifacts/list");

    assert.equal(r.status, 401, `workspace listing leaked (${r.body.slice(0, 160)})`);
  });

  it("serves the artifacts listing to the operator", async () => {
    const r = await request("/artifacts/list", withToken);

    assert.equal(r.status, 200);
  });

  it("refuses the artifact BYTES without a token", async () => {
    // Found by writing the unit test above: /artifacts/list was in the strict
    // list, /artifacts/file was in neither, so the listing answered 401 while
    // the download answered 200 with the workspace file — measured at 76894
    // bytes, byte-identical to the authenticated response. The gate now covers
    // the prefix; this drives the same enforcement line the default-publicUi
    // gateway hits, since matchUiRoute("/artifacts/file") is null either way.
    const listing = await request("/artifacts/list", withToken);
    const files = JSON.parse(listing.body).files || [];
    assert.deepEqual(
      files.map((f) => f.path),
      [ARTIFACT_REL],
      "the seeded artifact is what the gateway lists"
    );

    const anon = await request(`/artifacts/file?path=${encodeURIComponent(ARTIFACT_REL)}`);

    assert.equal(anon.status, 401, `artifact bytes leaked (${anon.body.slice(0, 160)})`);
    assert.ok(!anon.body.includes(ARTIFACT_BODY.trim()), "the file contents came back anyway");
  });

  it("serves the artifact BYTES to the operator", async () => {
    const r = await request(`/artifacts/file?path=${encodeURIComponent(ARTIFACT_REL)}`, withToken);

    assert.equal(r.status, 200, `operator lost the download (${r.body.slice(0, 160)})`);
    assert.equal(r.body, ARTIFACT_BODY);
  });

  it("serves the same page at / and /chat", async () => {
    // The router treats them as one page; the gate has to as well. If a future
    // change moves the webchat page off "/", this is the test that says so.
    const root = await request("/", withToken);
    const chat = await request("/chat", withToken);

    assert.equal(root.status, 200);
    assert.equal(chat.body, root.body);
  });
});
