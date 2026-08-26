import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeHost, hostPasses } from "../src/runtime/host-compat.mjs";
import { libClearsWalResetWindow } from "../src/persist/sql-safety.mjs";

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
