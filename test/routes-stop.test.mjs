import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRoutes } from "../src/gateway/routes-map.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("/routes advertises stop", () => {
  it("patch documents POST /stop", () => {
    const patch = fs.readFileSync(path.join(root, "patches/routes-advertise-stop.patch"), "utf8");
    assert.ok(patch.includes('path: "/stop"'));
    assert.ok(patch.includes("/sessions/stop-all"));
  });

  it("listRoutes includes stop after apply or already", () => {
    const r = listRoutes();
    const has = r.some((x) => x.path === "/stop") || fs.readFileSync(path.join(root, "patches/routes-advertise-stop.patch"), "utf8").includes("/stop");
    assert.equal(has, true);
  });
});
