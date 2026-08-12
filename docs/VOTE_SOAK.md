# Vote soak testing methodology

How to validate **structured majority voting** and **tie-break** under repeatable conditions.

---

## 1. Goals

| Goal | Pass criteria |
|------|----------------|
| **Correctness** | Clear majorities → expected `consensus` |
| **Tie policy** | Each `voteTieBreak` strategy matches spec |
| **Robustness** | Bad/missing JSON does not crash join |
| **Role filter** | Non-`voteRoles` ballots ignored |
| **Weights** | Higher role weight can beat raw count |
| **Integration** | Live swarm join summary contains vote section |

---

## 2. Layers

```text
L1  Unit        test/swarm-vote.test.mjs
L2  Scenario    scripts/soak-vote.mjs  (synthetic ballots)
L3  Integration swarm run with 3 research nodes (real or mock LLM)
L4  Regression  re-run L1+L2 on every ship
```

---

## 3. L1 — Unit (always)

```bash
node --test test/swarm-vote.test.mjs
```

Covers: parse, tally, unbroken tie, first/lexical/confidence/prefer breaks.

---

## 4. L2 — Scenario soak (synthetic)

```bash
node scripts/soak-vote.mjs
node scripts/soak-vote.mjs --scenario tie_confidence,tie_none
node scripts/soak-vote.mjs --json
```

| Scenario | Intent |
|----------|--------|
| `clear_majority` | 2-of-3 agree |
| `tie_confidence` | Equal counts → higher confidence |
| `tie_none` | Strict: no winner |
| `tie_lexical` | Alphabetical break |
| `parse_mixed` | 1 garbage text, 2 valid |
| `ignore_implement` | Implement JSON ignored |
| `weighted_role` | Critic weight 3 vs 2× research |

**Pass:** all scenarios `PASS`, exit code 0.

---

## 5. L3 — Integration (swarm join)

### 3a. Mock-style (no API cost)

Feed three fixed research results into `structuredMajorityVote` inside a small script, or use S1 `spawnSubagent` mock to return texts with JSON ballots, then assert `vote.consensus` on the swarm return value.

### 3b. Live (API cost)

```text
Goal: "Is label buy or hold for scenario X? Each research agent must end with JSON ballot."
Tasks: 3× role=research, same question, voteEnabled true
```

Checklist:

```text
[ ] Join summary has "## Structured majority vote"
[ ] consensus object present when ≥2 valid ballots agree
[ ] SwarmRun persistence includes vote.stats
[ ] xclaw swarm show <id> --summary shows vote block
```

### Ballot template for agents

```json
{ "label": "buy|hold|sell", "risk": "low|med|high", "confidence": 0.0 }
```

---

## 6. Matrix (manual / CI)

| Case | Config | Expected |
|------|--------|----------|
| 3× same label | default | consensus.label set |
| 1–1 tie | `voteTieBreak: none` | no consensus.label |
| 1–1 tie | `confidence` | higher confidence wins |
| 1–1 tie | `prefer` + preferValues | preferred if in tie set |
| 2 valid + 1 noise | default | majority of valid only |
| minShare 0.67 | 2-of-3 | pass; 2-of-4 fail share |
| voteEnabled false | — | no vote section |

---

## 7. Metrics to log (soak nights)

| Metric | Source |
|--------|--------|
| parseFailures / ballotCount | `vote` object |
| tied vs tiedBroken fields | `fields.*.tie` |
| share distribution | `fields.*.share` |
| Join latency with N research | wall clock |

Alert if parse failure rate **> 50%** on live research (prompt not followed).

---

## 8. Failure triage

| Symptom | Check |
|---------|--------|
| Always no consensus | Agents omit JSON → tighten prompt / examples |
| Always ties | Same model + same seed → raise N or temperature diversity |
| Wrong winner | Confirm tieBreak + weights |
| Vote section missing | `voteEnabled`, validBallots, join code path |

---

## 9. Ship gate

```text
[ ] L1 unit green
[ ] L2 soak-vote.mjs all PASS
[ ] Optional L3 one live or mock swarm with vote in summary
```

---

## 10. Bottom line

Soak voting in **layers**: unit → synthetic scenarios → one integrated swarm.  
Do not rely only on live LLM for correctness; **synthetic scenarios fix the algorithm**, live runs fix **prompt compliance**.
