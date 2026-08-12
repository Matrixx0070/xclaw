import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approveMergeProposal, createMergeTools } from "../src/agents/swarm-merge.mjs";

describe("swarm merge approval principal gate (P0)", () => {
  it("agent principal is denied by default", async () => {
    const out = await approveMergeProposal({ profile: "lab", swarm: {} }, "prop_x", {
      principal: "agent",
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, "PRINCIPAL_DENIED");
    assert.match(out.error, /operator/i);
  });

  it("agent principal is denied in prod even with the lab override set", async () => {
    const out = await approveMergeProposal(
      { profile: "prod", swarm: { allowAgentMergeApprove: true } },
      "prop_x",
      { principal: "agent" }
    );
    assert.equal(out.ok, false);
    assert.equal(out.code, "PRINCIPAL_DENIED");
  });

  it("lab override permits agent principal past the gate", async () => {
    const out = await approveMergeProposal(
      { profile: "lab", swarm: { allowAgentMergeApprove: true } },
      "prop_does_not_exist",
      { principal: "agent" }
    );
    // Gate passed — fails later on proposal lookup, NOT on principal
    assert.equal(out.ok, false);
    assert.equal(out.code, "PROPOSAL_NOT_FOUND");
  });

  it("operator principal (default) passes the gate", async () => {
    const out = await approveMergeProposal({ profile: "prod", swarm: {} }, "prop_does_not_exist", {});
    assert.equal(out.ok, false);
    assert.equal(out.code, "PROPOSAL_NOT_FOUND"); // not PRINCIPAL_DENIED
  });

  it("the model-callable tool carries the agent principal", async () => {
    const tools = createMergeTools({ cfg: { profile: "prod", swarm: {} }, workingDir: process.cwd() });
    const approve = tools.find((t) => t.name === "xclaw_swarm_merge_approve");
    const res = await approve.execute({ proposalId: "prop_x" });
    assert.equal(res.isError, true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.code, "PRINCIPAL_DENIED");
  });
});
