# HMAC timing mitigation

`verifyPagerDutySignature` applies:

1. **HMAC always computed** for every configured secret before accept/reject.
2. **Missing signature** still runs dummy compares (no skip of crypto path).
3. **`safeEqualHex`** hashes both sides to fixed 32-byte digests, then
   `crypto.timingSafeEqual` — avoids early return on length mismatch.
4. **No early `return true` inside loops** that skips remaining compares
   in a way that changes total work dramatically for first-match vs last-match;
   match flag is OR-accumulated (work scales with secrets × signatures).

Limits: Node.js and network jitter dominate over microsecond MAC differences.
This mitigates classic string-compare leaks; it is not a formal constant-time proof.
