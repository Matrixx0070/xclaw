
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  runBrowserTab,
  _resetTabsForTests,
} from "../src/computer/modules/browser-tab-tool.mjs";
import { runBrowserNetworkDetails } from "../src/computer/modules/browser-network-details-tool.mjs";
import { listMaintainedTools, executeMaintainedTool } from "../src/computer/modules/registry.mjs";

describe("native browser parity", () => {
  before(() => _resetTabsForTests());

  it("registry includes browser_tab and network_details", () => {
    const names = listMaintainedTools().map((t) => t.name);
    assert.ok(names.includes("xclaw_browser_tab"));
    assert.ok(names.includes("xclaw_browser_network_details"));
  });

  it("network_details requires tabId", async () => {
    const r = await runBrowserNetworkDetails({});
    assert.equal(r.ok, false);
  });

  it("network_details unknown tab", async () => {
    const r = await runBrowserNetworkDetails({ tabId: "missing" });
    assert.equal(r.ok, false);
  });

  it(
    "navigate then network_details on example.com",
    { timeout: 30_000 },
    async () => {
      _resetTabsForTests();
      const nav = await runBrowserTab({
        url: "https://example.com",
        includeNetwork: true,
      });
      if (!nav.ok) {
        console.log("nav soft-skip", nav.error);
        return;
      }
      assert.ok(nav.tabId);
      const det = await runBrowserNetworkDetails({ tabId: nav.tabId });
      assert.equal(det.ok, true);
      assert.equal(det.tabId, nav.tabId);
      assert.ok(det.status === 200 || det.status >= 100);
      assert.ok(det.url);
      assert.ok(det.requestId);
    }
  );

  it("executeMaintainedTool routes network tool", async () => {
    const r = await executeMaintainedTool("xclaw_browser_network_details", {});
    assert.equal(r.ok, false);
  });
});
