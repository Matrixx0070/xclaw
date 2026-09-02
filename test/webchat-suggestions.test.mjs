import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("webchat suggestions surface", () => {
  it("app.js renders chips and feedback", () => {
    const js = fs.readFileSync(path.join(root, "ui/webchat/app.js"), "utf8");
    assert.match(js, /renderSuggestionChips/);
    assert.match(js, /recordChipFeedback/);
    assert.match(js, /\/channel\/webchat\/suggestions\/feedback/);
  });

  it("sidebar messageCount refreshes after every send, not only sessionId change", () => {
    const js = fs.readFileSync(path.join(root, "ui/webchat/app.js"), "utf8");
    const send = js.slice(js.indexOf("async function sendMessage"), js.indexOf("function wireCopyButtons"));
    const finallyBlock = send.slice(send.lastIndexOf("} finally {"));
    assert.match(finallyBlock, /refreshSessions\(\)/);
    const assign = send.match(/if \(result\.sessionId && result\.sessionId !== sessionId\) \{[\s\S]*?\}/);
    assert.ok(assign, "sessionId-change block present");
    assert.doesNotMatch(assign[0], /refreshSessions\(\)/);
  });

  it("composer Enter ignores IME composition", () => {
    const js = fs.readFileSync(path.join(root, "ui/webchat/app.js"), "utf8");
    assert.match(js, /e\.isComposing \|\| e\.keyCode === 229/);
  });

  it("speak button plays returned audio before reporting success", () => {
    const js = fs.readFileSync(path.join(root, "ui/webchat/app.js"), "utf8");
    assert.match(js, /audioBase64/);
    assert.match(js, /new Audio\(/);
    assert.match(js, /TTS: no audio returned/);
    const voice = fs.readFileSync(path.join(root, "src/gateway/routes/voice.mjs"), "utf8");
    assert.match(voice, /out\.audioBase64 = buf\.toString\("base64"\)/);
  });

  it("styles include chip-row", () => {
    const css = fs.readFileSync(path.join(root, "ui/webchat/styles.css"), "utf8");
    assert.match(css, /\.chip-row/);
    assert.match(css, /\.chip:hover/);
  });

  it("webchat handler returns suggestions field", () => {
    const src = fs.readFileSync(
      path.join(root, "src/channels/webchat/index.mjs"),
      "utf8"
    );
    assert.match(src, /suggestions: result\.suggestions/);
    assert.match(src, /turnState: result\.turnState/);
  });

  it("grafana dashboard exports key promql", () => {
    const dash = JSON.parse(
      fs.readFileSync(
        path.join(root, "deploy/grafana/xclaw-agent-suggestions-dashboard.json"),
        "utf8"
      )
    );
    const exprs = JSON.stringify(dash);
    assert.match(exprs, /xclaw_suggestion_tap_rate/);
    assert.match(exprs, /xclaw_tool_status_total/);
    assert.match(exprs, /xclaw_turn_phase_total/);
    assert.equal(dash.uid, "xclaw-agent-suggestions");
  });
});
