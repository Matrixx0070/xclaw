import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bunPasses,
  describeHost,
  describeRuntime,
  hostPasses,
  runtimeCompatBanner,
} from "../src/runtime/host-compat.mjs";
import { libClearsWalResetWindow } from "../src/persist/sql-safety.mjs";

function readRepo(rel) {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("host line", () => {
  it("lets patched 22/24/25 and newer majors through", () => {
    for (const v of ["22.22.3", "v22.22.4", "24.15.0", "24.19.1", "25.9.0", "26.0.1"]) {
      assert.equal(hostPasses(v), true, v);
    }
  });

  it("blocks 23 and unpatched even lines", () => {
    for (const v of ["20.19.5", "21.7.3", "22.22.2", "23.11.0", "24.14.1", "24.12.0", "25.8.0"]) {
      assert.equal(describeHost(v).allowed, false, v);
    }
  });
});

describe("bundled library window", () => {
  it("clears known-good libraries", () => {
    assert.equal(libClearsWalResetWindow("3.51.3"), true);
    assert.equal(libClearsWalResetWindow("3.52.0"), true);
    assert.equal(libClearsWalResetWindow("3.50.7"), true);
    assert.equal(libClearsWalResetWindow("3.44.6"), true);
  });
  it("rejects the WAL-reset window", () => {
    assert.equal(libClearsWalResetWindow("3.50.6"), false);
    assert.equal(libClearsWalResetWindow("3.49.2"), false);
    assert.equal(libClearsWalResetWindow("not-a-version"), false);
  });
});

describe("bun host gate (spec §11.1)", () => {
  it("bunPasses is false on empty / unparseable and below 1.4.0", () => {
    assert.equal(bunPasses(""), false);
    assert.equal(bunPasses(null), false);
    assert.equal(bunPasses("not-a-version"), false);
    assert.equal(bunPasses("1.3.9"), false);
    assert.equal(bunPasses("1.3.0"), false);
    assert.equal(bunPasses("0.15.0"), false);
  });

  it("bunPasses lets 1.4.0, 1.5, and 2.x through", () => {
    assert.equal(bunPasses("1.4.0"), true);
    assert.equal(bunPasses("1.4.1"), true);
    assert.equal(bunPasses("1.5.0"), true);
    assert.equal(bunPasses("2.0.0"), true);
  });

  it("describeRuntime is kind node when bun is unset", () => {
    const info = describeRuntime({ bun: "", node: "22.22.3" });
    assert.equal(info.kind, "node");
    assert.equal(info.allowed, true);
    assert.equal(info.band, "22.x");
  });

  it("this process is kind node — Node remains the ship default", () => {
    const info = describeRuntime();
    assert.equal(info.kind, "node");
    assert.equal(Boolean(process.versions.bun), false);
    assert.equal(bunPasses(), false);
  });

  it("describeRuntime refuses Bun below floor even with a safe sqlite", () => {
    const info = describeRuntime({ bun: "1.3.9", sqlite: "3.51.3" });
    assert.equal(info.kind, "bun");
    assert.equal(info.allowed, false);
    assert.match(info.detail, /below 1\.4\.0/);
    assert.match(runtimeCompatBanner(info), /refused to start on Bun/);
  });

  it("describeRuntime refuses Bun 1.4.0 without node:sqlite", () => {
    const info = describeRuntime({ bun: "1.4.0", sqlite: null });
    assert.equal(info.kind, "bun");
    assert.equal(info.allowed, false);
    assert.match(info.detail, /no usable node:sqlite/);
  });

  it("describeRuntime refuses Bun 1.4.0 with WAL-unsafe sqlite", () => {
    const info = describeRuntime({ bun: "1.4.0", sqlite: "3.50.6" });
    assert.equal(info.kind, "bun");
    assert.equal(info.allowed, false);
    assert.match(info.detail, /not WAL-reset safe/);
  });

  it("describeRuntime allows Bun 1.4.0 with WAL-safe sqlite", () => {
    const info = describeRuntime({ bun: "1.4.0", sqlite: "3.51.3" });
    assert.equal(info.kind, "bun");
    assert.equal(info.allowed, true);
    assert.equal(info.sqlite, "3.51.3");
  });

  it("CLI boot and init refuse via describeRuntime, not describeHost", () => {
    const cli = readRepo("../bin/xclaw.mjs");
    const init = readRepo("../src/cli/init.mjs");
    const doctor = readRepo("../src/cli/doctor.mjs");
    assert.match(cli, /describeRuntime/);
    assert.match(cli, /runtimeCompatBanner/);
    assert.equal(/describeHost\(/.test(cli), false);
    assert.match(init, /describeRuntime/);
    assert.match(init, /runtimeCompatBanner/);
    assert.equal(/describeHost\(/.test(init), false);
    assert.match(doctor, /runtimeLine\.kind === "bun"/);
    assert.match(doctor, /push\("bun"/);
    assert.match(doctor, /s === "bun"/);
  });
});
