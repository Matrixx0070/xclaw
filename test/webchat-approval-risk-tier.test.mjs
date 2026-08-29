/**
 * Class 38, second surface: the value a whole subsystem exists to compute never
 * reaches the human it was computed for.
 *
 * v3.352.0 fixed this for Telegram. The webchat approval card — the OTHER
 * surface an operator approves from — had the identical two-layer drop, and a
 * literal grep proves it: `grep -n "risk" ui/webchat/app.js` returned nothing
 * at all. The stream handler hand-narrowed the `approval_required` event to
 * `{pendingId, name, args, timedOut}` (the capability-dropped-in-transit shape
 * of v3.323.0), and `addApprovalCard`'s HTML template had no tier slot to
 * render into even if the field had survived the hop.
 *
 * The gateway is not the culprit: `src/gateway/index.mjs` forwards the event
 * object verbatim (`produce(e.type || "message", e)`) and `event-types.mjs` is
 * a frozen vocabulary, not a field filter. `riskTier` reaches the browser; the
 * UI threw it away.
 *
 * There is no shared module to fix this in. The browser loads `ui/` statically
 * and cannot import `src/`, and importing `ui/` from server code inverts the
 * dependency direction into the bundle. So the vocabulary is necessarily
 * duplicated — which is exactly the condition class 38 describes, two surfaces
 * free to disagree about the same judgement. The consistency case below is the
 * guard that duplication requires.
 *
 * The reasons deliberately do NOT ship here either, for the reason recorded in
 * `inline.mjs`: `assessRisk`'s reasons are filesystem-shaped and fabricated for
 * third-party tools. The tier is correct; only the tier ships.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  riskTierOf,
  approvalCardFromEvent,
  riskChip,
  RISK_TIER_SEVERITY,
} from "../ui/webchat/risk-tier.mjs";
import { TIER_LABEL } from "../src/channels/telegram/inline.mjs";

const appSrc = () => fs.readFile(new URL("../ui/webchat/app.js", import.meta.url), "utf8");
const cssSrc = () => fs.readFile(new URL("../ui/webchat/styles.css", import.meta.url), "utf8");

describe("the webchat approval card carries the risk tier", () => {
  it("reads the flat shape the approval_required event actually emits", () => {
    // src/agent/loop.mjs:1353 — `riskTier: info.risk?.tier || null`
    assert.equal(riskTierOf({ riskTier: "critical" }), "critical");
  });

  it("reads the nested shape listPending returns", () => {
    assert.equal(riskTierOf({ risk: { tier: "risky" } }), "risky");
  });

  it("claims nothing when there is no tier to claim", () => {
    assert.equal(riskTierOf({}), null);
    assert.equal(riskTierOf({ riskTier: "" }), null);
    assert.equal(riskTierOf({ riskTier: 3 }), null);
    assert.equal(riskTierOf(null), null);
  });

  it("carries the tier across the transit hop that used to drop it", () => {
    const card = approvalCardFromEvent({
      type: "security",
      phase: "approval_required",
      pendingId: "apr_1",
      name: "file_write",
      args: { file_path: "/root/x" },
      riskTier: "critical",
    });
    assert.equal(card.riskTier, "critical", "the tier must survive the narrowing");
    assert.equal(card.pendingId, "apr_1");
    assert.equal(card.name, "file_write");
    assert.deepEqual(card.args, { file_path: "/root/x" });
  });

  it("carries the tier when the producer sends the nested object instead", () => {
    const card = approvalCardFromEvent({ pendingId: "apr_2", risk: { tier: "safe" } });
    assert.equal(card.riskTier, "safe");
  });

  it("keeps timedOut — the field the stale-card path reads", () => {
    assert.equal(approvalCardFromEvent({ pendingId: "a", timedOut: true }).timedOut, true);
  });

  it("renders a distinct chip per tier — three tiers must not look alike", () => {
    const crit = riskChip({ riskTier: "critical" });
    const safe = riskChip({ riskTier: "safe" });
    assert.ok(crit && safe, "both tiers must produce a chip");
    assert.notDeepEqual(crit, safe, "critical and safe rendered identically");
    assert.match(crit.label, /CRITICAL/);
    assert.equal(crit.severity, "critical");
  });

  it("renders no chip at all when the tier is unknown to the producer", () => {
    // An absent tier must produce absence, never a fabricated "SAFE".
    assert.equal(riskChip({}), null);
    assert.equal(riskChip({ riskTier: null }), null);
  });

  it("does not invent a severity for a tier it has never seen", () => {
    const chip = riskChip({ riskTier: "elevated" });
    assert.ok(chip, "an unrecognised tier is still information — render it");
    assert.equal(chip.severity, "unknown", `severity ${chip.severity} was fabricated`);
    assert.match(chip.label, /ELEVATED/);
  });
});

describe("the two approval surfaces must not drift apart", () => {
  it("names exactly the tiers Telegram names", () => {
    // No shared module is possible (browser cannot import src/), so the
    // duplication is guarded here instead. A tier added to one surface and not
    // the other is the class-38 failure repeating.
    assert.deepEqual(
      Object.keys(RISK_TIER_SEVERITY).sort(),
      Object.keys(TIER_LABEL).sort(),
      "webchat and Telegram disagree about which risk tiers exist"
    );
  });

  it("has a stylesheet rule for every severity it can emit", () => {
    // A chip with no CSS rule is a chip nobody sees — the same defect one
    // layer down.
    const css = cssSrc();
    return css.then((text) => {
      const severities = new Set([...Object.values(RISK_TIER_SEVERITY), "unknown"]);
      for (const s of severities) {
        assert.match(text, new RegExp(`\\.apr-risk-${s}\\b`), `no CSS for .apr-risk-${s}`);
      }
    });
  });
});

describe("the webchat call site is wired to the carrier", () => {
  // The handler runs only inside a live SSE stream in a browser, so it cannot
  // be exercised in-process. Pin the source, exactly as
  // test/risk-readonly-precision.test.mjs pins the sibling surfaces.
  it("narrows the event through the shared carrier", async () => {
    const src = await appSrc();
    assert.match(src, /approvalCardFromEvent\(data\)/, "handler must use the carrier");
    assert.match(src, /riskChip\(/, "the card must ask for a chip");
  });

  it("no longer hand-builds the narrowed event", async () => {
    const src = await appSrc();
    // The exact literal any revert must reintroduce.
    assert.doesNotMatch(src, /name:\s*data\.name/, "hand-narrowing is back — the tier is dropped again");
  });

  it("escapes the chip it renders", async () => {
    const src = await appSrc();
    // chip.label is derived from a producer-supplied string.
    assert.match(src, /escapeHtml\(chip\.label\)/, "chip label reaches innerHTML unescaped");
  });
});
