/**
 * Terminal decorative prefix (spec §16.4) — emoji only on a UTF-8 TTY
 * that renders it; strip pictographs everywhere else. Env and TTY are
 * injected via opts / process.env save-restore.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  decorateLine,
  emojiTtyOk,
  stripLineGlyphs,
} from "../src/cli/decorate-line.mjs";

const ENV_KEYS = ["TERM", "TERM_PROGRAM", "LC_ALL", "LC_CTYPE", "LANG", "WT_SESSION"];
let saved;

describe("decorate-line (spec §16.4)", () => {
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("emojiTtyOk: not a TTY or TERM=dumb or non-UTF-8 locale refuse", () => {
    process.env.TERM_PROGRAM = "iTerm.app";
    assert.equal(emojiTtyOk(process.env, { isTty: false, platform: "linux" }), false);
    process.env.TERM = "dumb";
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "linux" }), false);
    process.env.TERM = "xterm-256color";
    process.env.LANG = "C";
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "linux" }), false);
    process.env.LANG = "en_US.UTF-8";
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "linux" }), true);
    delete process.env.TERM_PROGRAM;
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "linux" }), false);
    process.env.WT_SESSION = "1";
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "linux" }), true);
  });

  it("emojiTtyOk: known terminals and darwin default allow", () => {
    process.env.TERM_PROGRAM = "ghostty";
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "linux" }), true);
    delete process.env.TERM_PROGRAM;
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "darwin" }), true);
    assert.equal(emojiTtyOk(process.env, { isTty: true, platform: "linux" }), false);
  });

  it("decorateLine prefixes only when emoji TTY; stripLineGlyphs removes pictographs otherwise", () => {
    process.env.TERM_PROGRAM = "vscode";
    const on = { isTty: true, platform: "linux" };
    const off = { isTty: false, platform: "linux" };
    assert.equal(decorateLine("🔥", "deploy ok", on), "🔥 deploy ok");
    assert.equal(decorateLine("🔥", "deploy ok", off), "deploy ok");
    assert.equal(stripLineGlyphs("🔥 deploy 🚀 ok", off), "deploy ok");
    assert.equal(stripLineGlyphs("🔥 deploy ok", on), "🔥 deploy ok");
    assert.equal(stripLineGlyphs("1⃣ step", off), "1 step");
    assert.equal(stripLineGlyphs("plain text", off), "plain text");
  });
});
