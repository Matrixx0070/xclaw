/**
 * gateway.publicUi=false — the operator's "the UI is not public" switch.
 *
 * It had no test of any kind (zero occurrences of "publicUi" under test/) while
 * being shipped ON by the prod profile, and it was broken two ways. Both were
 * reproduced on real sockets against real child gateways before this file
 * existed:
 *
 *   1. It locked one path of three. index.mjs serves the webchat page at "/",
 *      "/chat" and "/chat/"; the auth list matched "/chat/". With a token
 *      configured and the lockdown on, GET /chat/ answered 401 and GET /chat
 *      answered 200 with the page. Two hand-written lists of one route set —
 *      the /v1 (3.190.0) and /ws/voice (3.191.0) shape again. Fixed by giving
 *      both callers gateway/ui-routes.mjs.
 *
 *   2. It INVERTED the fail-closed contract. The branch returned `required`,
 *      which short-circuits the `!required && !requireAuth` check below it, so
 *      on a requireAuth gateway with no token yet configured, turning the
 *      lockdown ON opened everything it claimed to close. Measured, same config
 *      but for the flag: GET /artifacts/list returned 401 with publicUi:true
 *      and 200 with a 50-entry listing of the real workspace with
 *      publicUi:false.
 *
 * The pure half is here; test/gateway-publicui-lockdown.test.mjs drives a real
 * gateway, because a unit test that asserts the auth list cannot catch the auth
 * list disagreeing with the router.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";
import { matchUiRoute, isWebchatEnabled } from "../src/gateway/ui-routes.mjs";

const TOKEN = "tok-public-ui";

/** Every path index.mjs + routes/artifacts.mjs serve a UI page at. */
const UI_PATHS = [
  "/",
  "/chat",
  "/chat/",
  "/chat/app.js",
  "/control",
  "/control/",
  "/control/app.js",
  "/artifacts",
  "/artifacts/",
];

describe("ui-routes: one table for the static UI", () => {
  it("matches every path the gateway serves a UI page at", () => {
    for (const p of UI_PATHS) {
      assert.ok(matchUiRoute(p), `${p} serves a UI page but the table misses it`);
    }
  });

  it("does not swallow the artifacts API routes", () => {
    // startsWith("/artifacts") here is exactly what leaked the workspace.
    assert.equal(matchUiRoute("/artifacts/list"), null);
    assert.equal(matchUiRoute("/artifacts/file"), null);
  });

  it("routes each path to its own app + file", () => {
    assert.deepEqual(matchUiRoute("/chat"), { app: "webchat", rel: "index.html" });
    assert.deepEqual(matchUiRoute("/chat/app.js"), { app: "webchat", rel: "app.js" });
    assert.deepEqual(matchUiRoute("/control"), { app: "control", rel: "index.html" });
    assert.deepEqual(matchUiRoute("/control/x/y.css"), { app: "control", rel: "x/y.css" });
    assert.deepEqual(matchUiRoute("/artifacts"), { app: "artifacts", rel: "index.html" });
  });

  it("drops the webchat paths when webchat is off", () => {
    const off = { webchatEnabled: false };
    assert.equal(matchUiRoute("/", off), null);
    assert.equal(matchUiRoute("/chat", off), null);
    // control + artifacts are not webchat and stay.
    assert.ok(matchUiRoute("/control", off));
    assert.ok(matchUiRoute("/artifacts", off));
  });

  it("reads the webchat switch the one way", () => {
    assert.equal(isWebchatEnabled({}), true);
    assert.equal(isWebchatEnabled({ channels: { webchat: {} } }), true);
    assert.equal(isWebchatEnabled({ channels: { webchat: { enabled: false } } }), false);
  });

  it("leaves non-UI paths alone", () => {
    for (const p of ["/health", "/dashboard", "/hooks", "/chatty", "/controlled"]) {
      assert.equal(matchUiRoute(p), null, `${p} is not a UI page`);
    }
  });
});

describe("publicUi:false locks down the whole UI", () => {
  const auth = createGatewayAuth({ gateway: { token: TOKEN, publicUi: false } });

  it("protects every UI path, bare and trailing-slash alike", () => {
    for (const p of UI_PATHS) {
      assert.equal(auth.isProtectedPath(p), true, `${p} escaped the lockdown`);
    }
  });

  it("still lets the liveness probes through", () => {
    // A lockdown that takes /health down with it is a different outage.
    for (const p of ["/health", "/ready", "/version", "/favicon.ico"]) {
      assert.equal(auth.isProtectedPath(p), false, `${p} must stay open`);
    }
  });
});

describe("publicUi defaults to a public UI", () => {
  const auth = createGatewayAuth({ gateway: { token: TOKEN } });

  it("leaves the UI open", () => {
    for (const p of UI_PATHS) {
      assert.equal(auth.isProtectedPath(p), false, `${p} must stay public by default`);
    }
  });

  it("keeps the artifacts API protected anyway", () => {
    assert.equal(auth.isProtectedPath("/artifacts/list"), true);
    assert.equal(auth.isProtectedPath("/artifacts/file"), true);
  });
});

describe("the lockdown never makes the gateway more open", () => {
  // The inversion, as a property: for every path, publicUi:false must protect
  // at least as much as publicUi:true. This is the assertion that was false.
  const configs = [
    ["token configured", { token: TOKEN }],
    ["requireAuth, no token", { requireAuth: true }],
    ["prod profile shape", { requireAuth: true, host: "127.0.0.1" }],
  ];

  for (const [label, gateway] of configs) {
    it(`holds with ${label}`, () => {
      const open = createGatewayAuth({ gateway: { ...gateway, publicUi: true } });
      const locked = createGatewayAuth({ gateway: { ...gateway, publicUi: false } });
      for (const p of [...UI_PATHS, "/artifacts/list", "/artifacts/file", "/dashboard", "/hooks"]) {
        if (open.isProtectedPath(p)) {
          assert.equal(locked.isProtectedPath(p), true, `${p}: lockdown UNPROTECTED it`);
        }
      }
    });
  }

  it("fails closed on a requireAuth gateway with no token", () => {
    // The measured case: 200 with a listing of the real workspace.
    const locked = createGatewayAuth({ gateway: { requireAuth: true, publicUi: false } });
    assert.equal(locked.isProtectedPath("/artifacts/list"), true);
    for (const p of UI_PATHS) {
      assert.equal(locked.isProtectedPath(p), true, `${p} was open on a locked-down prod gateway`);
    }
  });

  it("locks the UI down on the prod profile", () => {
    // config/profiles.mjs ships { requireAuth: true, publicUi: false }.
    const prod = createGatewayAuth({ profile: "prod", gateway: { requireAuth: true, publicUi: false } });
    for (const p of UI_PATHS) assert.equal(prod.isProtectedPath(p), true, `${p} open in prod`);
  });
});
