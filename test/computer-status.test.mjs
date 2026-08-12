import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computerProbeHost,
  computerBaseUrl,
  computerPidPath,
  getComputerStatus,
} from "../src/computer/manager.mjs";

describe("computer status helpers", () => {
  it("maps bind-any host to 127.0.0.1", () => {
    assert.equal(computerProbeHost({ computer: { host: "0.0.0.0", port: 4243 } }), "127.0.0.1");
    assert.ok(computerBaseUrl({ computer: { host: "0.0.0.0", port: 4243 } }).includes("127.0.0.1"));
  });
  it("pid path under config dir", () => {
    const p = computerPidPath({ paths: { configDir: "/tmp/xclaw-test-cfg" } });
    assert.ok(p.includes("computer.pid"));
  });
  it("getComputerStatus returns shape", async () => {
    const st = await getComputerStatus({
      computer: { host: "127.0.0.1", port: 4243 },
      paths: { configDir: "/tmp/xclaw-status-missing" },
    });
    assert.equal(typeof st.healthy, "boolean");
    assert.ok(st.url);
    assert.ok(st.logPath);
  });
});
