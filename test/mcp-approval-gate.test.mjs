import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApprovalGate } from "../src/security/approvals.mjs";
import { createMcpClient } from "../src/mcp/client.mjs";

// 2026-08-13 MCP audit finding #3: under the default "risky" policy, approval
// only matched the requireApproval name list — every mcp__server__tool ran
// unapproved. MCP tools are third-party code and must default to approval.

describe("MCP tools require approval by default", () => {
  it("risky policy: mcp__* needs approval, native reads stay auto", () => {
    const gate = createApprovalGate({ security: {} });
    assert.equal(gate.needsApproval("mcp__github__delete_repo"), true);
    assert.equal(gate.needsApproval("mcp__anything__whatever"), true);
    assert.equal(gate.needsApproval("xclaw_file_read"), false);
    assert.equal(gate.needsApproval("xclaw_bash"), true);
  });

  it("safeAuto can whitelist a specific MCP tool", () => {
    const gate = createApprovalGate({
      security: { safeAuto: ["mcp__github__get_issue"] },
    });
    assert.equal(gate.needsApproval("mcp__github__get_issue"), false);
    assert.equal(gate.needsApproval("mcp__github__delete_repo"), true);
  });

  it("mcpAutoApprove: true opts out globally (explicit operator choice)", () => {
    const gate = createApprovalGate({ security: { mcpAutoApprove: true } });
    assert.equal(gate.needsApproval("mcp__github__delete_repo"), false);
    // native risky tools unaffected by the MCP opt-out
    assert.equal(gate.needsApproval("xclaw_bash"), true);
  });

  it("policy=never / autoApprove still win (unchanged semantics)", () => {
    assert.equal(
      createApprovalGate({ security: { approvalPolicy: "never" } })
        .needsApproval("mcp__x__y"),
      false
    );
    assert.equal(
      createApprovalGate({ security: { autoApprove: true } })
        .needsApproval("mcp__x__y"),
      false
    );
  });
});

describe("per-server MCP tool filters", () => {
  it("allowTools exposes only the listed tools; denyTools hides", async () => {
    // Stub HTTP server via fetch monkeypatch (single POST JSON shape).
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const result =
        body.method === "tools/list"
          ? {
              tools: [
                { name: "read_issue", description: "r" },
                { name: "delete_repo", description: "d" },
                { name: "comment", description: "c" },
              ],
            }
          : {};
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ jsonrpc: "2.0", id: body.id ?? null, result }),
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result }),
      };
    };
    try {
      const allow = createMcpClient({
        servers: [{ name: "gh", url: "http://x/mcp", allowTools: ["read_issue"] }],
      });
      const allowed = await allow.listTools();
      assert.deepEqual(
        allowed.filter((t) => t._mcp).map((t) => t._mcp.tool),
        ["read_issue"]
      );

      const deny = createMcpClient({
        servers: [{ name: "gh", url: "http://x/mcp", denyTools: ["delete_repo"] }],
      });
      const denied = await deny.listTools();
      assert.deepEqual(
        denied.filter((t) => t._mcp).map((t) => t._mcp.tool).sort(),
        ["comment", "read_issue"]
      );

      // a filtered tool is uncallable even by exact name
      const out = await allow.callTool("mcp__gh__delete_repo", {});
      assert.equal(out.isError, true);
    } finally {
      global.fetch = realFetch;
    }
  });
});
