import { getS3RetryTotal } from "./audit-s3.mjs";

export function renderS3RetryLine() {
  return `xclaw_gossip_audit_s3_retry_total ${getS3RetryTotal()}\n`;
}

export default { renderS3RetryLine };
