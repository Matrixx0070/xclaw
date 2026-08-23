import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPlane,
  getConcurrencyClass,
  classifyTool,
  partitionByConcurrency,
  inferPlane,
} from "../src/tools/planes.mjs";

describe("T0 tool planes", () => {
  it("classifies bash as computer serial", () => {
    assert.equal(getPlane("xclaw_bash"), "computer");
    assert.equal(getConcurrencyClass("xclaw_bash"), "serial");
  });

  it("classifies file_read as computer parallel-safe", () => {
    assert.equal(getPlane("xclaw_file_read"), "computer");
    assert.equal(getConcurrencyClass("xclaw_file_read"), "parallel-safe");
  });

  it("classifies web_search as search parallel-safe", () => {
    assert.equal(getPlane("web_search"), "search");
    assert.equal(getConcurrencyClass("web_search"), "parallel-safe");
  });

  it("classifies browser as computer serial", () => {
    assert.equal(getPlane("xclaw_browser_tab"), "computer");
    assert.equal(getConcurrencyClass("xclaw_browser_tab"), "serial");
  });

  it("classifies mcp search as mcp parallel-safe", () => {
    assert.equal(getPlane("search_connected_tools"), "mcp");
    assert.equal(getConcurrencyClass("search_connected_tools"), "parallel-safe");
  });

  it("classifyTool returns full record", () => {
    const c = classifyTool("xclaw_file_write");
    assert.equal(c.plane, "computer");
    assert.equal(c.concurrency, "serial");
  });

  it("local browser CUA tools route to the LOCAL plane (Trust Sprint fix)", () => {
    // Before the explicit TOOL_PLANE entries, the /browser|…/ regex sent all
    // 8 registered local browser tools to the computer plane, where no such
    // tool exists — they were unreachable in every live run.
    for (const n of [
      "browser_screenshot",
      "browser_snapshot",
      "browser_clipboard",
      "browser_pdf",
      "browser_observe",
      "browser_assert",
      "browser_click",
      "browser_type",
    ]) {
      assert.equal(getPlane(n), "local", `${n} must dispatch locally`);
    }
    // the true bundle browser tools stay on the computer plane
    assert.equal(getPlane("browser_tab"), "computer");
    assert.equal(getPlane("xclaw_browser_tab"), "computer");
    assert.equal(getPlane("browser_network_details"), "computer");
    // actuation stays serial
    assert.equal(getConcurrencyClass("browser_click"), "serial");
    assert.equal(getConcurrencyClass("browser_type"), "serial");
  });

  it("inferPlane handles unknown browser-like names", () => {
    assert.equal(inferPlane("custom_browser_navigate"), "computer");
  });

  it("partitionByConcurrency splits batch", () => {
    const { parallel, serial } = partitionByConcurrency([
      { name: "xclaw_file_read" },
      { name: "xclaw_bash" },
      { name: "web_search" },
      { name: "xclaw_file_write" },
    ]);
    assert.equal(parallel.length, 2);
    assert.equal(serial.length, 2);
    assert.ok(parallel.every((c) => getConcurrencyClass(c.name) === "parallel-safe"));
    assert.ok(serial.every((c) => getConcurrencyClass(c.name) === "serial"));
  });
});
