# Wire loop.mjs to plan fingerprints

After merging the secure-tool-call helper, apply this surgical change to `src/agent/loop.mjs`.

## 1. Import

After:
```js
import { getSharedApprovalGate } from "../security/approvals.mjs";
```

Add:
```js
import {
  authorizeToolInLoop,
} from "./secure-tool-call.mjs";
```

## 2. Replace the security block

Replace the block starting at `// Security: allowlist + optional human approval`
through the `if (auth.mode === "human") { ... }` block with:

```js
        // Security: allowlist + optional human approval (systemRunPlan-bound)
        const sec = await authorizeToolInLoop({
          approvalGate,
          name,
          args,
          cfg,
          onEvent,
          formatBlockedReply,
        });
        if (!sec.allowed) {
          if (sec.lastPending) {
            lastPendingApproval = sec.lastPending;
          }
          if (sec.isPending && !finalText) {
            finalText = sec.message;
          }
          messages.push(
            makeToolMessage({
              tool_call_id: call.id,
              content: sec.message,
              source: "security",
            })
          );
          toolTrace.push(
            finalizeToolTraceEntry(
              beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }),
              {
                resultText: sec.message,
                blocked: true,
                policy: sec.policy,
              }
            )
          );
          if (sec.isPending) {
            break;
          }
          continue;
        }
        const auth = sec.auth;
```

## 3. Attach policy on successful toolTrace

In `finalizeToolTraceEntry(tracePartial, { ... })`, add:

```js
          policy: sec.policy || undefined,
```

This makes SSE security events and toolTrace receipts carry `planFingerprint`.
