/**
 * S3: orchestrators that own segmentation pass continuation:false so the
 * inner loop keeps a single-segment contract (totalTurnCap = maxTurns,
 * not maxTurns * 4). Channel startDetachedObjective already did.
 * Gateway startGatewayObjective (POST /objectives, boot auto-resume via
 * resumeObjectiveDetached) omitted the flag — replyWithAgent only
 * forwards continuation when the caller set it, so undefined meant ON.
 *
 * Running a live gateway here would mean a real agent loop. Pin the
 * invariant at the source instead: both live runSegment bodies pass
 * continuation: false next to history: [].
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readRepo(rel) {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

function runSegmentBody(src) {
  const start = src.indexOf("const runSegment = async");
  assert.ok(start >= 0, "could not locate runSegment");
  const end = src.indexOf("};", start);
  assert.ok(end > start, "could not locate end of runSegment");
  return src.slice(start, end);
}

describe("objective runSegment opts out of inner-loop continuation", () => {
  it("gateway POST /objectives runSegment passes continuation: false", () => {
    const body = runSegmentBody(readRepo("../src/gateway/routes/objectives.mjs"));
    assert.match(body, /continuation:\s*false/, "gateway runSegment must opt out of S3 auto-continue");
    assert.match(body, /history:\s*\[\]/, "gateway runSegment must still start each segment with empty history");
  });

  it("channel startDetachedObjective runSegment still passes continuation: false", () => {
    const body = runSegmentBody(readRepo("../src/channels/runtime.mjs"));
    assert.match(body, /continuation:\s*false/, "channel runSegment must keep the S3 opt-out");
    assert.match(body, /history:\s*\[\]/, "channel runSegment must still start each segment with empty history");
  });
});
