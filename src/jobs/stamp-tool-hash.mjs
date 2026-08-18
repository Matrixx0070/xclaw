import { buildToolHashChain } from "../agent/tool-hash-chain.mjs";

export function stampJobToolHash(job = {}) {
  if (job.toolHashTip && job.toolHashVersion) return job;
  const chain = buildToolHashChain(job.toolTrace || []);
  job.toolHashTip = chain.tip;
  job.toolHashVersion = chain.version;
  return job;
}

export default { stampJobToolHash };
