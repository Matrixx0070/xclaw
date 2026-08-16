# WildClawBench + XClaw

[WildClawBench](https://github.com/InternLM/WildClawBench) (MIT) is a **60-task** long-horizon suite built around the **OpenClaw** harness (~8 min / 20+ tools per task).

## What we did **not** do today

- Did not claim full 60-task parity in one day
- Full suite needs Docker workspaces, tool mapping, hybrid graders, and hours of runtime

## Path

1. **A4-native pack** (`eval/cases/autonomy-a4.json`) — XClaw goals, deterministic checks (shipped)
2. Optional: `git submodule add https://github.com/InternLM/WildClawBench.git third_party/WildClawBench`
3. Tool bridge + Docker runner (W1–W4) — separate milestone
4. Report scores as **WildClawBench @ XClaw harness**, never as OpenClaw scores

## License

Respect MIT attribution when vendoring InternLM/WildClawBench.
