import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  createComputerClient,
  clearComputerSessionPool,
} from "../src/agent/computer-client.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function health() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4243/health", (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

describe("computer session reuse", () => {
  before(async () => {
    process.env.XCLAW_COMPUTER_ENGINE = "native";
    process.env.XCLAW_COMPUTER_REUSE_SESSION = "1";
    if (!(await health())) {
      spawn(process.execPath, [path.join(root, "src/computer/thin-server.mjs")], {
        cwd: root,
        detached: true,
        stdio: "ignore",
      }).unref();
      for (let i = 0; i < 30; i++) {
        if (await health()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    clearComputerSessionPool();
  });

  it("reuses session id for same workingDir", async () => {
    const cfg = {
      computer: { host: "127.0.0.1", port: 4243, engine: "native", reuseSession: true },
    };
    const c = createComputerClient(cfg);
    const wd = path.join(root, "tmp-live");
    const a = await c.createSession(wd);
    const b = await c.createSession(wd);
    assert.equal(a, b);
    await c.destroySession(a);
    const c2 = await c.createSession(wd);
    assert.equal(c2, a); // still pooled after soft destroy
  });
});
