import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land stampJobToolHash in runJob", () => {
  it("job.mjs imports and calls stampJobToolHash", () => {
    const src = fs.readFileSync(path.join(root, "src/jobs/job.mjs"), "utf8");
    assert.ok(src.includes('from "./stamp-tool-hash.mjs"'));
    assert.ok(src.includes("stampJobToolHash(job)"));
  });
});
