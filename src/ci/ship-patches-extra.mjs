/**
 * Extra ship-pack entries (history hash, memory redact, digest cron, …).
 */
export const EXTRA_SHIP_PATCHES = [
  {
    file: "job-history-hash-tip.patch",
    files: ["src/jobs/history.mjs"],
    needles: ["toolHashTip", "buildToolHashChain"],
  },
  {
    file: "memory-soak-redact.patch",
    files: ["src/memory/durable.mjs", "src/eval/soak.mjs"],
    needles: ["redactEvent"],
  },
  {
    file: "gateway-digest-cron-boot.patch",
    files: ["src/gateway/index.mjs"],
    needles: ["ensureApprovalDigestCronJob"],
  },
  {
    file: "stamp-job-tool-hash.patch",
    files: ["src/jobs/job.mjs"],
    needles: ["stampJobToolHash"],
  },
  {
    file: "doctor-perf-ensure.patch",
    files: ["src/cli/doctor.mjs"],
    needles: ["pushPerfChecksEnsured"],
  },
  {
    file: "release-gate-ensure-cold-start.patch",
    files: ["src/eval/release-gate.mjs"],
    needles: ["ensureColdStartReport"],
  },
];

export function extraShipEntries(read) {
  return EXTRA_SHIP_PATCHES.map((e) => ({
    file: e.file,
    isApplied: (rootDir) =>
      e.files.every((f) => {
        const t = read(rootDir, f);
        return e.needles.every((n) => t.includes(n));
      }),
  }));
}

export default { EXTRA_SHIP_PATCHES, extraShipEntries };
