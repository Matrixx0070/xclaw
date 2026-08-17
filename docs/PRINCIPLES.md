# Autonomous agent principles

XClaw treats the agent as a **long-lived subordinate**, not a chat demo.

## Axioms

1. **Goal-first** — work until verify succeeds or budget/safety stops you  
2. **Grounding** — never invent files, paths, or tool results  
3. **Verify-by-tool** — re-read / re-run checks after mutations  
4. **Minimal force** — smallest tool sequence; no busy loops  
5. **Recoverable** — mid-run checkpoints; coherent workspace for resume  
6. **Fail closed** — approval / policy / budget → report, don’t fake success  
7. **Structured claims** — JSON claims + evidence_ids from real tools  
8. **Killable** — respect abort; inspectable via doctor / checkpoints / runs  

## How they are enforced

| Mechanism | Role |
|-----------|------|
| Autonomy levels (`off`→`full`) | How much auto-approve / heartbeat |
| `xclaw harness` | Long-run + hard ground + principles notes |
| Evidence + claim scorer | Fail job if claims lack tool proof |
| Mid-run checkpoints | Survive crash / budget stop |
| Recovery strategies | Tailored resume prompts by failure kind |
| Cost governor | Hard stop on spend |

## Code

- `src/agent/principles.mjs` — text + `principlesForLevel` / `applyPrinciplesToHarnessOpts`
- Injected into harness system notes automatically

```bash
xclaw harness "your long goal" --exists out.txt
```


## Path-binding (claims ↔ tools)

Hard grounding also checks that **file paths named in claims** appear in tool evidence summaries (basename match allowed). Prevents “I wrote secrets/x.txt” after only touching other files.

See `src/jobs/claims.mjs` (`extractClaimPaths` / path bind in `scoreClaimsAgainstEvidence`).
