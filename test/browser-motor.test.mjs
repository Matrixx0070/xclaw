import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planClick,
  planType,
  planScroll,
  planMotor,
  executeSteps,
} from "../src/browser/motor.mjs";
import { loadMotor, planMotorOnly } from "../src/computer/motor-bridge.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

describe("Phase A4 humanized motor", () => {
  it("planClick emits mouseMoved path ending in press/release", () => {
    const { steps, meta } = planClick({ x: 200, y: 100, fromX: 0, fromY: 0, targetWidth: 20 });
    assert.ok(steps.length > 5);
    assert.ok(steps.some((s) => s.method === "Input.dispatchMouseEvent" && s.params.type === "mouseMoved"));
    assert.ok(steps.some((s) => s.params.type === "mousePressed"));
    assert.ok(steps.some((s) => s.params.type === "mouseReleased"));
    assert.equal(meta.kind, "click");
    assert.ok(meta.fittsMs > 0);
  });

  it("planType emits key events per character", () => {
    const { steps, meta } = planType({ text: "Hi" });
    assert.equal(meta.length, 2);
    const downs = steps.filter((s) => s.params?.type === "keyDown");
    assert.ok(downs.length >= 2);
  });

  it("planScroll emits wheel ticks", () => {
    const { steps, meta } = planScroll({ x: 10, y: 10, deltaY: 400 });
    assert.ok(meta.chunks >= 1);
    assert.ok(steps.some((s) => s.params?.type === "mouseWheel"));
  });

  it("planMotor dispatches by op", () => {
    const p = planMotor({ op: "click", x: 1, y: 2 });
    assert.equal(p.meta.kind, "click");
  });

  it("executeSteps drives mock CDP client", async () => {
    const calls = [];
    const client = {
      Input: {
        async dispatchMouseEvent(params) {
          calls.push(["mouse", params.type]);
        },
        async dispatchKeyEvent(params) {
          calls.push(["key", params.type]);
        },
      },
    };
    const { steps } = planClick({ x: 50, y: 50, fromX: 40, fromY: 40, targetWidth: 30 });
    // strip long sleeps for test speed
    const fast = steps.map((s) => ({ ...s, delayMs: 0 }));
    const r = await executeSteps(client, fast, { sleep: async () => {} });
    assert.ok(r.executed > 0);
    assert.ok(calls.some((c) => c[0] === "mouse"));
  });

  it("motor-bridge loads planMotor", async () => {
    process.env.XCLAW_ROOT = process.cwd();
    const m = await loadMotor();
    assert.ok(m?.planClick);
    const plan = await planMotorOnly({ op: "type", text: "a" });
    assert.equal(plan.meta.kind, "type");
  });

  it("browser_click and browser_type registered", () => {
    const names = createBrowserTools({}).map((t) => t.name);
    assert.ok(names.includes("browser_click"));
    assert.ok(names.includes("browser_type"));
  });
});
