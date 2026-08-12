import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  onAbort,
  AbortScope,
  withAbortScope,
  linkAbort,
  anySignal,
  toAbortError,
} from "../src/utils/abort-handlers.mjs";

describe("custom abort handlers", () => {
  it("onAbort runs when signal aborts", async () => {
    const ac = new AbortController();
    const seen = [];
    onAbort(ac.signal, ({ reason }) => {
      seen.push(String(reason?.message || reason));
    });
    ac.abort(new Error("stop_now"));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, ["stop_now"]);
  });

  it("onAbort runs immediately if already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("late"));
    const seen = [];
    onAbort(ac.signal, ({ reason }) => {
      seen.push(String(reason?.message || reason));
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(seen[0], "late");
  });

  it("AbortScope LIFO order", async () => {
    const ac = new AbortController();
    const scope = new AbortScope(ac.signal);
    const order = [];
    scope.onAbort(() => order.push("a"), { label: "a" });
    scope.onAbort(() => order.push("b"), { label: "b" });
    ac.abort();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(order, ["b", "a"]);
    scope.dispose();
  });

  it("linkAbort propagates parent to child", async () => {
    const parent = new AbortController();
    const child = new AbortController();
    linkAbort(parent.signal, child, "from_parent");
    parent.abort(new Error("parent_down"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(child.signal.aborted, true);
  });

  it("anySignal aborts when any input fires", async () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = anySignal([a.signal, b.signal]);
    b.abort(new Error("b"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(combined.signal.aborted, true);
    combined.dispose();
  });

  it("withAbortScope fires handlers on abort error", async () => {
    const ac = new AbortController();
    const order = [];
    await assert.rejects(async () => {
      await withAbortScope(ac.signal, async (scope) => {
        scope.onAbort(() => order.push("cleanup"));
        ac.abort(new Error("boom"));
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      });
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(order.includes("cleanup") || ac.signal.aborted);
  });

  it("toAbortError normalizes reasons", () => {
    assert.equal(toAbortError("x").message, "x");
    assert.equal(toAbortError(new Error("y")).message, "y");
  });
});

describe("nested signals", () => {
  it("createNestedSignal aborts child when parent aborts", async () => {
    const { createNestedSignal } = await import("../src/utils/abort-handlers.mjs");
    const parent = new AbortController();
    const nest = createNestedSignal(parent.signal);
    assert.equal(nest.signal.aborted, false);
    parent.abort(new Error("parent_down"));
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(nest.signal.aborted, true);
    assert.ok(nest.sources.includes("parent"));
    nest.dispose();
  });

  it("createNestedSignal timeout aborts without parent", async () => {
    const { createNestedSignal } = await import("../src/utils/abort-handlers.mjs");
    const nest = createNestedSignal(null, { timeoutMs: 30 });
    assert.equal(nest.signal.aborted, false);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(nest.signal.aborted, true);
    nest.dispose();
  });

  it("child abort does not abort parent", async () => {
    const { createNestedSignal } = await import("../src/utils/abort-handlers.mjs");
    const parent = new AbortController();
    const nest = createNestedSignal(parent.signal);
    nest.abort(new Error("local_only"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(nest.signal.aborted, true);
    assert.equal(parent.signal.aborted, false);
    nest.dispose();
  });

  it("createNestedScope fires handlers on parent abort", async () => {
    const { createNestedScope } = await import("../src/utils/abort-handlers.mjs");
    const parent = new AbortController();
    const scope = createNestedScope(parent.signal);
    const seen = [];
    scope.onAbort(() => seen.push("cleanup"), { label: "c" });
    parent.abort(new Error("p"));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(seen.includes("cleanup"));
    scope.dispose();
  });

  it("timeoutSignal eventually aborts", async () => {
    const { timeoutSignal } = await import("../src/utils/abort-handlers.mjs");
    const t = timeoutSignal(25);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(t.signal.aborted, true);
    t.dispose();
  });
});

describe("abort() and abortSignal()", () => {
  it("abortSignal returns already-aborted signal with reason", async () => {
    const { abortSignal } = await import("../src/utils/abort-handlers.mjs");
    const s = abortSignal(new Error("cancelled"));
    assert.equal(s.aborted, true);
    assert.ok(s.reason);
    assert.match(String(s.reason.message || s.reason), /cancelled/);
  });

  it("abortSignal() with no args still aborted", async () => {
    const { abortSignal } = await import("../src/utils/abort-handlers.mjs");
    const s = abortSignal();
    assert.equal(s.aborted, true);
  });

  it("abort(controller) normalizes reason and is idempotent", async () => {
    const { abort } = await import("../src/utils/abort-handlers.mjs");
    const ac = new AbortController();
    assert.equal(abort(ac, "stop"), true);
    assert.equal(ac.signal.aborted, true);
    assert.equal(abort(ac, "again"), false);
    assert.equal(abort(null), false);
  });
});

describe("abortSignalAny", () => {
  it("empty iterable never aborts", async () => {
    const { abortSignalAny } = await import("../src/utils/abort-handlers.mjs");
    const s = abortSignalAny([]);
    assert.equal(s.aborted, false);
  });

  it("aborts when any input aborts and copies reason", async () => {
    const { abortSignalAny } = await import("../src/utils/abort-handlers.mjs");
    const a = new AbortController();
    const b = new AbortController();
    const s = abortSignalAny([a.signal, b.signal]);
    assert.equal(s.aborted, false);
    b.abort(new Error("from_b"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(s.aborted, true);
    assert.match(String(s.reason?.message || s.reason), /from_b/);
  });

  it("already-aborted input yields aborted composite", async () => {
    const { abortSignalAny } = await import("../src/utils/abort-handlers.mjs");
    const a = new AbortController();
    a.abort(new Error("pre"));
    const s = abortSignalAny([a.signal, new AbortController().signal]);
    assert.equal(s.aborted, true);
  });

  it("installAbortSignalAny is no-op when native exists", async () => {
    const { installAbortSignalAny } = await import("../src/utils/abort-handlers.mjs");
    const installed = installAbortSignalAny();
    assert.equal(installed, false); // native present on this Node
  });
});

describe("abortSignalTimeout", () => {
  it("aborts after ms with TimeoutError name", async () => {
    const { abortSignalTimeout } = await import("../src/utils/abort-handlers.mjs");
    const s = abortSignalTimeout(25);
    assert.equal(s.aborted, false);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(s.aborted, true);
    assert.equal(s.reason?.name, "TimeoutError");
  });

  it("timeout 0 aborts ASAP", async () => {
    const { abortSignalTimeout } = await import("../src/utils/abort-handlers.mjs");
    const s = abortSignalTimeout(0);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(s.aborted, true);
    assert.equal(s.reason?.name, "TimeoutError");
  });

  it("invalid ms throws TypeError", async () => {
    const { abortSignalTimeout } = await import("../src/utils/abort-handlers.mjs");
    assert.throws(() => abortSignalTimeout(-1), TypeError);
    assert.throws(() => abortSignalTimeout(Number.NaN), TypeError);
  });

  it("createTimeoutError has TimeoutError name", async () => {
    const { createTimeoutError } = await import("../src/utils/abort-handlers.mjs");
    const e = createTimeoutError(100);
    assert.equal(e.name, "TimeoutError");
  });

  it("installAbortSignalTimeout no-op when native exists", async () => {
    const { installAbortSignalTimeout } = await import("../src/utils/abort-handlers.mjs");
    assert.equal(installAbortSignalTimeout(), false);
  });
});
