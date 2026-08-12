import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listVoiceAgentPresets,
  getVoiceAgentPreset,
} from "../src/voice/agents/presets.mjs";
import { createVoiceAgent } from "../src/voice/agents/runtime.mjs";
import { personalAssistantCard } from "../src/voice/agents/personal-assistant.mjs";

describe("voice agent presets", () => {
  it("lists screenshot-style templates", () => {
    const list = listVoiceAgentPresets();
    const ids = list.map((x) => x.id);
    assert.ok(ids.includes("personal_assistant"));
    assert.ok(ids.includes("customer_support"));
    assert.ok(ids.includes("sales_associate"));
    assert.ok(ids.includes("appointment_scheduler"));
    assert.ok(ids.includes("lead_qualification"));
  });

  it("personal assistant has full system control", () => {
    const p = getVoiceAgentPreset("personal_assistant");
    assert.equal(p.systemControl, true);
    assert.equal(p.autonomy, "full");
    assert.ok(p.tools.includes("xclaw_bash"));
    assert.ok(p.tools.includes("xclaw_swarm_run"));
  });

  it("card exposes capabilities", () => {
    const c = personalAssistantCard();
    assert.match(c.blurb, /full control/i);
    assert.ok(c.capabilities.length >= 4);
  });
});

describe("voice agent runtime", () => {
  it("runs tool without cancelling on barge-in", async () => {
    let toolStarted = false;
    let toolFinished = false;
    const agent = createVoiceAgent({
      preset: "personal_assistant",
      tools: {
        xclaw_bash: async () => {
          toolStarted = true;
          await new Promise((r) => setTimeout(r, 30));
          toolFinished = true;
          return { ok: true, stdout: "hi" };
        },
      },
      think: async () => ({
        text: "",
        toolCalls: [{ name: "xclaw_bash", arguments: { command: "echo hi" } }],
      }),
      speak: async () => {},
    });

    const p = agent.handleUserUtterance("run a quick command");
    agent.bargeIn({ reason: "user" });
    const out = await p;
    assert.equal(toolStarted, true);
    assert.equal(toolFinished, true);
    assert.equal(out.ok, true);
  });
});
