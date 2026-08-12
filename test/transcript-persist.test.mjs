import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendTranscript,
  loadTranscriptHistory,
  listTranscripts,
  transcriptPath,
} from "../src/sessions/transcript.mjs";

describe("persistent transcripts", () => {
  it("appends and loads user/assistant turns", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tr-"));
    const cfg = { paths: { transcriptsDir: dir } };
    const id = "sess-test-1";
    assert.equal(appendTranscript(cfg, id, { role: "user", content: "hello" }).ok, true);
    assert.equal(
      appendTranscript(cfg, id, { role: "assistant", content: "world" }).ok,
      true
    );
    const hist = loadTranscriptHistory(cfg, id, 40);
    assert.equal(hist.length, 2);
    assert.equal(hist[0].content, "hello");
    assert.equal(hist[1].content, "world");
    assert.ok(fs.existsSync(transcriptPath(cfg, id)));
  });

  it("caps history from the end", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tr2-"));
    const cfg = { paths: { transcriptsDir: dir } };
    const id = "sess-cap";
    for (let i = 0; i < 20; i++) {
      appendTranscript(cfg, id, { role: "user", content: `m${i}` });
    }
    const hist = loadTranscriptHistory(cfg, id, 5);
    assert.equal(hist.length, 5);
    assert.equal(hist[0].content, "m15");
  });

  it("listTranscripts returns entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tr3-"));
    const cfg = { paths: { transcriptsDir: dir } };
    appendTranscript(cfg, "a", { role: "user", content: "x" });
    const list = listTranscripts(cfg);
    assert.ok(list.some((t) => t.sessionId === "a"));
  });
});
