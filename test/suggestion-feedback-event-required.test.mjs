/**
 * POST /channel/webchat/suggestions/feedback must not invent event=shown.
 *
 * Live 2026-09-02 pid 3800483 (version 3.491.0): POST {} returned 200
 * {ok:true} and bumped xclaw_suggestion_feedback_shown 78→79 because
 * `event: body.event || "shown"`. Writer already no-ops unknown events
 * (`recordDurableSuggestionFeedback` returns null unless shown|tapped|
 * dismissed). The HTTP path was the fail-open. Client always sends event.
 * Do not invert: explicit shown|tapped|dismissed still 200. Do not mint
 * persistRun. Homedir JSON store-writer class remains EXHAUSTED at 3.560.0.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function feedbackHandlerSlice() {
  const src = readFileSync(path.join(ROOT, "src/gateway/index.mjs"), "utf8");
  const start = src.indexOf(
    'if (webchatEnabled && p === "/channel/webchat/suggestions/feedback"'
  );
  const end = src.indexOf(
    'if (webchatEnabled && p === "/channel/webchat/message"',
    start
  );
  assert.ok(start >= 0 && end > start, "feedback handler slice not found");
  return src.slice(start, end);
}

describe("suggestions/feedback event is required", () => {
  test("handler does not default missing event to shown", () => {
    const slice = feedbackHandlerSlice();
    assert.doesNotMatch(slice, /body\.event\s*\|\|\s*"shown"/);
    assert.match(
      slice,
      /event required \(shown\|tapped\|dismissed\)/
    );
    assert.match(slice, /json\(res,\s*400/);
  });

  test("handler accepts only shown|tapped|dismissed", () => {
    const slice = feedbackHandlerSlice();
    assert.match(
      slice,
      /\["shown",\s*"tapped",\s*"dismissed"\]\.includes\(event\)/
    );
  });

  test("writer still no-ops unknown events (HTTP must not invent one)", () => {
    const src = readFileSync(
      path.join(ROOT, "src/agent/suggestion-feedback.mjs"),
      "utf8"
    );
    const start = src.indexOf("export async function recordDurableSuggestionFeedback");
    const end = src.indexOf("export function scoreBiasFromStats");
    assert.ok(start >= 0 && end > start, "writer slice not found");
    const slice = src.slice(start, end);
    assert.match(slice, /\["shown",\s*"tapped",\s*"dismissed"\]\.includes\(event\)/);
    assert.match(slice, /return null/);
  });

  test("webchat client always sends event", () => {
    const src = readFileSync(path.join(ROOT, "ui/webchat/app.js"), "utf8");
    assert.match(src, /recordChipFeedback\(s,\s*"shown"\)/);
    assert.match(src, /recordChipFeedback\(s,\s*"tapped"\)/);
    assert.match(src, /JSON\.stringify\(\{[\s\S]*event,/);
  });
});
