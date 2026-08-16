import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gradeMeetingNegotiation,
  gradeConflictingHandling,
  runHardGrader,
} from "../src/eval/hard-graders.mjs";

describe("hard graders", () => {
  it("meeting pass sample", () => {
    const text = `
# result
Thursday 09:30-11:00, 90 minutes, Conference Room B.
Attendees: Li Wei, Zhang Min, Wang Fang. Director Chen notified.
`;
    assert.equal(gradeMeetingNegotiation(text).length, 0);
  });

  it("meeting fail missing thursday", () => {
    const f = gradeMeetingNegotiation("Room B Li Wei Zhang Min Wang Fang 10:00");
    assert.ok(f.some((x) => x.includes("thursday")));
  });

  it("conflict pass sample", () => {
    const text = "诉讼时效为二年，适用民法通则；8月邮件导致中断；不构成国际货物买卖四年。";
    assert.equal(gradeConflictingHandling(text).length, 0);
  });

  it("runHardGrader by id", async () => {
    const r = await runHardGrader(
      { id: "wc-c-03_Social_Interaction_task_1_meeting_negotiation", expect: { hard: { grader: "meeting_negotiation" } } },
      {
        text: "Thursday 10:00-11:30 Conference Room A. Li Wei, Zhang Min, Wang Fang.",
      }
    );
    assert.equal(r.ok, true);
  });
});
