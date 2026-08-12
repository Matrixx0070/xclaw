---
name: example-shell
description: Prefer safe, explicit shell commands with short outputs.
---

# Example shell skill

When running shell commands via `xclaw_bash`:

1. Prefer non-interactive flags (`-y` only when safe and intended).
2. Cap large outputs (`head`, `tail`, or pipe to `wc`).
3. Do not run destructive commands (`rm -rf`, `mkfs`, disk wipe) unless the user explicitly asks.
4. After writing files, verify with a quick `ls` or `test -f`.
