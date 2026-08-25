/**
 * The approval-decision endpoints must require the operator token.
 *
 * routes/approvals.mjs serves /approvals + /approvals/pending (GET),
 * /approvals/approve + /approvals/deny (POST) and /agent-runs (GET). routes-map
 * declares /approvals as "Alias: pending approvals" — the same data and the same
 * decide() call as /security/pending + /security/decide, which were gated. The
 * alias was in neither auth list, so on the DEFAULT gateway (not a non-default
 * mode — the shipped one) every one of these answered without credentials:
 *
 *   GET  /approvals            leaked each pending's full command — the path and
 *                              CONTENT of a critical-tier write (measured live)
 *   POST /approvals/approve    decided a critical pending: ok:true, mode:"human",
 *                              ledgered as actor:"operator", from no credentials
 *   GET  /agent-runs           streamed real persisted session history
 *
 * The last human gate in front of a risky command had no auth of its own. This
 * is the pure half — that isProtectedPath now puts the alias on the same side as
 * its canonical. gateway-approvals-live.test.mjs proves the wired behaviour on a
 * real socket, because a test of the auth list agrees with the list by
 * construction and cannot catch the list disagreeing with the router.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

const TOKEN = "tok-approvals";

/** Every path routes/approvals.mjs serves. Each decides or exposes an approval. */
const APPROVAL_PATHS = [
  "/approvals",
  "/approvals/pending",
  "/approvals/approve",
  "/approvals/deny",
  "/agent-runs",
];

describe("approval endpoints are token-gated", () => {
  it("protects every approval path when a token is set", () => {
    const auth = createGatewayAuth({ gateway: { token: TOKEN } });
    for (const p of APPROVAL_PATHS) {
      assert.equal(auth.isProtectedPath(p), true, `${p} answered without a token`);
    }
  });

  it("protects them on a prod gateway with no token yet configured", () => {
    const auth = createGatewayAuth({ gateway: { requireAuth: true } });
    for (const p of APPROVAL_PATHS) {
      assert.equal(auth.isProtectedPath(p), true, `${p} open on a fail-closed gateway`);
    }
  });

  it("puts the alias on the same side of the gate as its canonical", () => {
    // /approvals IS /security/pending; /approvals/approve IS /security/decide.
    // The whole bug was that these two drifted apart. Pin them together so a
    // future edit to one that forgets the other fails here.
    const auth = createGatewayAuth({ gateway: { token: TOKEN } });
    const pairs = [
      ["/approvals", "/security/pending"],
      ["/approvals/pending", "/security/pending"],
      ["/approvals/approve", "/security/decide"],
      ["/approvals/deny", "/security/decide"],
    ];
    for (const [alias, canonical] of pairs) {
      assert.equal(
        auth.isProtectedPath(alias),
        auth.isProtectedPath(canonical),
        `${alias} and ${canonical} landed on opposite sides of the gate`
      );
      assert.equal(auth.isProtectedPath(canonical), true, `${canonical} must be protected`);
    }
  });

  it("does not gate them away when no token and not prod (lab stays open)", () => {
    // A lab gateway with no token configured is open by design; the fix must not
    // secretly flip that — it only closes the alias when the canonical is closed.
    const auth = createGatewayAuth({ gateway: {} });
    for (const p of APPROVAL_PATHS) {
      assert.equal(auth.isProtectedPath(p), false, `${p} should follow the lab-open default`);
    }
    // ...and the canonical behaves identically, which is the whole invariant.
    assert.equal(auth.isProtectedPath("/security/pending"), false);
  });
});
