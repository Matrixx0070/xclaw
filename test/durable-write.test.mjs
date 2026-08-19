import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { durableWriteJson } from "../src/jobs/durable-write.mjs";

describe("durable write", () => {
  it("writes json via tmp+rename", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dur-"));
    const fp = path.join(dir, "x.json");
    await durableWriteJson(fp, { ok: true });
    assert.equal(JSON.parse(fs.readFileSync(fp, "utf8")).ok, true);
  });
});
