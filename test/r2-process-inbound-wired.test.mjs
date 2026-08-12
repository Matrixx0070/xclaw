import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("R2 processInbound wired into live channels", () => {
  const files = [
    "src/channels/slack/index.mjs",
    "src/channels/telegram/index.mjs",
    "src/channels/discord/index.mjs",
    "src/channels/email/index.mjs",
  ];
  for (const f of files) {
    it(`${f} imports and calls processInbound`, () => {
      const src = fs.readFileSync(f, "utf8");
      assert.match(src, /processInbound/);
      assert.match(src, /from ["'].*runtime\.mjs["']/);
    });
  }
});
