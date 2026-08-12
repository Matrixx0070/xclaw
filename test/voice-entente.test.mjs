import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEntente,
  classifyVoiceIntent,
} from "../src/voice/entente.mjs";

describe("classifyVoiceIntent", () => {
  it("detects stop talking", () => {
    assert.equal(classifyVoiceIntent("please shut up").kind, "stop_talking");
  });
  it("detects cancel job", () => {
    assert.equal(classifyVoiceIntent("cancel the swarm").kind, "cancel_job");
  });
  it("detects keep going", () => {
    assert.equal(classifyVoiceIntent("keep going").kind, "keep_going");
  });
});

describe("entente barge-in vs jobs", () => {
  it("barge-in does not cancel running jobs", () => {
    const e = createEntente({ narrateProgress: false });
    const id = e.jobs.start({ kind: "swarm", label: "research" });
    assert.equal(e.jobs.listActive().length, 1);

    const r = e.onBargeIn({ source: "test" });
    assert.equal(r.jobsCancelled, false);
    assert.equal(e.jobs.get(id).status, "running");
    assert.equal(e.jobs.listActive().length, 1);

    const inv = e.assertBargeInDoesNotCancelJobs();
    assert.equal(inv.ok, true);
  });

  it("explicit cancel stops jobs", () => {
    const e = createEntente({ narrateProgress: false });
    e.jobs.start({ kind: "agent" });
    const out = e.onUserText("cancel that task");
    assert.equal(out.intent.kind, "cancel_job");
    assert.equal(out.jobsCancelled, 1);
    assert.equal(e.jobs.listActive().length, 0);
  });

  it("stale speech epoch rejected", () => {
    const e = createEntente({ narrateProgress: false });
    const epoch = e.speech.getEpoch();
    e.speech.bargeIn();
    const r = e.speech.beginSpeak("hello", { epoch });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "stale_epoch");
  });
});
