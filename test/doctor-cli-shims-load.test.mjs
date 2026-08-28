import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every doctor probe is reached through a `src/cli/doctor-*.mjs` shim that its
// caller imports dynamically inside a try/catch, so a shim that throws at load
// degrades to `push(<probe>, "warn", <the JS error message>)` — a probe that
// never runs, wearing the costume of a probe that ran and found something mild.
// ops.auth_refresh shipped that way: it printed "pushAuthRefreshChecks is not
// defined" on the live gateway while a real error sat unreported behind it.
// The unit tests could not catch it because they import the source module the
// shim re-exports, which production never touches.
//
// So this pins the shims themselves, enumerated from disk rather than listed,
// because the next one added is the one nobody remembers to cover.
const CLI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli");
const SHIMS = fs
  .readdirSync(CLI_DIR)
  .filter((f) => f.startsWith("doctor-") && f.endsWith(".mjs"))
  .sort();

describe("doctor cli shims", () => {
  it("finds the shims to check", () => {
    assert.ok(SHIMS.length >= 25, `expected the doctor shim family, got ${SHIMS.length}`);
  });

  for (const file of SHIMS) {
    it(`${file} loads and exports what it names`, async () => {
      const mod = await import(path.join(CLI_DIR, file));

      // A re-export (`export { x } from`) creates no local binding, so naming
      // it in a default object throws here — the exact defect this pins.
      const named = Object.keys(mod).filter((k) => k !== "default");
      assert.ok(named.length > 0, `${file} exports nothing`);

      // ...and if it does bind, the default object must not hold undefined
      // holes, which is the same mistake surviving module evaluation.
      const def = mod.default;
      if (def && typeof def === "object") {
        const holes = Object.entries(def)
          .filter(([, v]) => v === undefined)
          .map(([k]) => k);
        assert.deepEqual(holes, [], `${file} default export has undefined keys`);
      }
    });
  }
});
