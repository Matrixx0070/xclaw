/**
 * doctor's computer.health row must grade the machine the computer actually
 * runs on. The probe used to derive its own loopback address inline while the
 * fallback probe went through computerBaseUrl, so on a computer.remoteUrl host
 * the two branches of one if/else asked two different machines — and a stray
 * local server graded a dead remote "up".
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computerHealthTarget, computerHealthRow } from "../src/cli/doctor-computer-health.mjs";

describe("doctor computer.health target", () => {
  test("a remote computer is probed at its remote url", () => {
    const cfg = { computer: { host: "127.0.0.1", port: 4243, remoteUrl: "http://10.0.0.5:9999" } };
    assert.equal(computerHealthTarget(cfg), "http://10.0.0.5:9999/health");
  });

  test("a local computer is probed at its configured port", () => {
    assert.equal(
      computerHealthTarget({ computer: { host: "127.0.0.1", port: 4300 } }),
      "http://127.0.0.1:4300/health"
    );
  });

  test("a wildcard bind is probed on loopback", () => {
    assert.equal(
      computerHealthTarget({ computer: { host: "0.0.0.0", port: 4243 } }),
      "http://127.0.0.1:4243/health"
    );
  });
});

describe("doctor computer.health row", () => {
  test("a healthy remote is reported as the remote, not as the local port", () => {
    const cfg = { computer: { host: "127.0.0.1", port: 4243, remoteUrl: "http://10.0.0.5:9999" } };
    const row = computerHealthRow(cfg, true);
    assert.equal(row.status, "ok");
    assert.match(row.message, /10\.0\.0\.5:9999/);
    assert.doesNotMatch(row.message, /4243/);
  });

  test("an unreachable remote is a warning that names the remote", () => {
    const cfg = { computer: { host: "127.0.0.1", port: 4243, remoteUrl: "http://10.0.0.5:9999" } };
    const row = computerHealthRow(cfg, false);
    assert.equal(row.status, "warn");
    assert.match(row.message, /10\.0\.0\.5:9999/);
    assert.doesNotMatch(row.message, /4243/);
  });

  test("the remedy for a remote does not tell the operator to start a local gateway", () => {
    const cfg = { computer: { remoteUrl: "http://10.0.0.5:9999" } };
    const row = computerHealthRow(cfg, false);
    assert.match(row.message, /remoteUrl/);
    assert.doesNotMatch(row.message, /xclaw gateway/);
  });

  test("what the probe reported survives into the row", () => {
    const row = computerHealthRow({ computer: { port: 4243 } }, false, "ECONNREFUSED");
    assert.match(row.message, /ECONNREFUSED/);
  });

  test("the remedy for a local computer still points at the gateway", () => {
    const row = computerHealthRow({ computer: { port: 4243 } }, false);
    assert.equal(row.status, "warn");
    assert.match(row.message, /xclaw gateway/);
  });

  test("a healthy local computer is ok", () => {
    const row = computerHealthRow({ computer: { port: 4243 } }, true);
    assert.equal(row.status, "ok");
    assert.match(row.message, /127\.0\.0\.1:4243/);
  });
});

describe("doctor computer.health wiring", () => {
  // runDoctor loads the real config itself, so the row cannot be reached from a
  // fixture. Read the caller as text instead: the pure module is only a fix if
  // the probe actually goes through it.
  const src = readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");

  test("runDoctor derives the computer probe target from the shared helper", () => {
    assert.match(src, /computerHealthTarget\(cfg\)/);
    assert.match(src, /computerHealthRow\(cfg, healthy, ch\.error \|\| ch\.status\)/);
  });

  test("runDoctor no longer derives a second computer address inline", () => {
    assert.doesNotMatch(src, /http:\/\/\$\{cHost/);
  });
});
