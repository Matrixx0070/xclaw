/**
 * Spec §11.6 + §11.10 — doctor --fix absorbers.
 * Default doctor is read-only. --fix absorbs leftover cron JSON (after
 * normalizeLegacyJob) and pairing.json, then renames each source to .bak
 * only if moved > 0. Does not rewrite xclaw.json.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDoctorFix } from "../src/cli/doctor-fix.mjs";
import { openCronLedger } from "../src/cron/durable-jobs.mjs";
import { openControlPlane } from "../src/state/control-plane.mjs";

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-doctor-fix-"));
  const configDir = path.join(dir, ".xclaw");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "xclaw.json"),
    JSON.stringify({ profile: "lab", agent: { apiKey: "test-key" } }, null, 2) + "\n",
  );
  return dir;
}

function cfgFor(dir) {
  const configDir = path.join(dir, ".xclaw");
  return {
    paths: {
      configDir,
      cronJobsFile: path.join(configDir, "cron-jobs.json"),
      cronLedgerFile: path.join(configDir, "cron", "jobs.sqlite"),
      stateDir: path.join(configDir, "state"),
      pairingFile: path.join(configDir, "pairing.json"),
    },
  };
}

function writeLegacyCron(file) {
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      jobs: [
        {
          jobId: "legacy-alpha",
          intervalMs: 60_000,
          threadId: "555",
          payload: { kind: "agent", prompt: "ping" },
        },
      ],
    }) + "\n",
  );
}

function writePairing(file) {
  fs.writeFileSync(
    file,
    JSON.stringify({
      channels: {
        telegram: {
          pending: [
            {
              id: "555",
              code: "ABCD2345",
              createdAt: "2026-08-26T00:00:00.000Z",
              lastSeenAt: "2026-08-26T00:00:00.000Z",
              meta: {},
            },
          ],
          approved: [
            {
              id: "777",
              meta: { name: "owner" },
              approvedAt: "2026-08-26T01:00:00.000Z",
            },
          ],
        },
      },
    }) + "\n",
  );
}

describe("doctor --fix", () => {
  it("absorbs leftover cron JSON after normalizeLegacyJob and pairing.json, then renames both to .bak", async () => {
    const dir = tmpHome();
    const cfg = cfgFor(dir);
    writeLegacyCron(cfg.paths.cronJobsFile);
    writePairing(cfg.paths.pairingFile);
    const xclawJson = path.join(cfg.paths.configDir, "xclaw.json");
    const beforeCfg = fs.readFileSync(xclawJson, "utf8");
    const checks = [];
    const push = (id, status, message) => checks.push({ id, status, message });
    try {
      await runDoctorFix(push, cfg);
      const cron = checks.find((c) => c.id === "fix.cron");
      const pairing = checks.find((c) => c.id === "fix.pairing");
      assert.equal(cron.status, "ok");
      assert.match(cron.message, /moved=1/);
      assert.equal(pairing.status, "ok");
      assert.match(pairing.message, /moved=2/);
      assert.equal(fs.existsSync(cfg.paths.cronJobsFile), false);
      assert.equal(fs.existsSync(`${cfg.paths.cronJobsFile}.bak`), true);
      assert.equal(fs.existsSync(cfg.paths.pairingFile), false);
      assert.equal(fs.existsSync(`${cfg.paths.pairingFile}.bak`), true);
      assert.equal(fs.readFileSync(xclawJson, "utf8"), beforeCfg);

      const ledger = openCronLedger(cfg);
      try {
        const listed = ledger.list();
        assert.equal(listed.length, 1);
        assert.equal(listed[0].id, "legacy-alpha");
        assert.deepEqual(listed[0].schedule, { kind: "every", everyMs: 60_000 });
        assert.deepEqual(listed[0].delivery, { threadId: "555" });
        assert.equal(listed[0].jobId, undefined);
        assert.equal(listed[0].intervalMs, undefined);
        assert.equal(listed[0].threadId, undefined);
      } finally {
        ledger.close();
      }

      const plane = openControlPlane(cfg);
      try {
        assert.equal(plane.prepare("SELECT COUNT(*) AS n FROM pair_pending").get().n, 1);
        assert.equal(plane.prepare("SELECT COUNT(*) AS n FROM pair_done").get().n, 1);
        const pending = plane.prepare("SELECT id FROM pair_pending").get();
        assert.equal(pending.id, "telegram:555");
      } finally {
        plane.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not rename empty leftover JSON (moved=0) and still reports ok", async () => {
    const dir = tmpHome();
    const cfg = cfgFor(dir);
    fs.writeFileSync(
      cfg.paths.cronJobsFile,
      JSON.stringify({ version: 1, jobs: [] }) + "\n",
    );
    fs.writeFileSync(
      cfg.paths.pairingFile,
      JSON.stringify({ channels: { telegram: { pending: [], approved: [] } } }) + "\n",
    );
    const checks = [];
    const push = (id, status, message) => checks.push({ id, status, message });
    try {
      await runDoctorFix(push, cfg);
      assert.equal(checks.find((c) => c.id === "fix.cron").message, "moved=0");
      assert.equal(checks.find((c) => c.id === "fix.pairing").message, "moved=0");
      assert.equal(fs.existsSync(cfg.paths.cronJobsFile), true);
      assert.equal(fs.existsSync(`${cfg.paths.cronJobsFile}.bak`), false);
      assert.equal(fs.existsSync(cfg.paths.pairingFile), true);
      assert.equal(fs.existsSync(`${cfg.paths.pairingFile}.bak`), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("default doctor (no --fix) does not absorb leftover JSON", async () => {
    const dir = tmpHome();
    const cfg = cfgFor(dir);
    writeLegacyCron(cfg.paths.cronJobsFile);
    writePairing(cfg.paths.pairingFile);
    const prevHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      const { runDoctor } = await import("../src/cli/doctor.mjs");
      const report = await runDoctor({ json: true, quiet: true });
      const ids = report.checks.map((c) => c.id);
      assert.equal(ids.includes("fix.cron"), false);
      assert.equal(ids.includes("fix.pairing"), false);
      assert.equal(fs.existsSync(cfg.paths.cronJobsFile), true);
      assert.equal(fs.existsSync(cfg.paths.pairingFile), true);
      assert.equal(fs.existsSync(`${cfg.paths.cronJobsFile}.bak`), false);
      assert.equal(fs.existsSync(`${cfg.paths.pairingFile}.bak`), false);
    } finally {
      process.env.HOME = prevHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
