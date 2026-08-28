/**
 * Spec §11.18 corruption recovery + §11.17 doctor probes.
 * Copies file/-wal/-shm to .corrupt.<stamp>, never deletes the original,
 * never loop-reopens from getControlPlane. Doctor reports; lock is busy
 * not corruption. Doctor probe does not quarantine.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifySqlProbe,
  notADatabaseError,
  probeSqlFile,
  quarantineSqlFile,
} from "../src/persist/sql-quarantine.mjs";
import {
  getControlPlane,
  openControlPlane,
  stopControlPlane,
} from "../src/state/control-plane.mjs";
import { openMemoryIndex } from "../src/memory/search-index.mjs";
import { openAgentStore } from "../src/state/agent-store.mjs";
import { openKit } from "../src/persist/query-kit.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-quarantine-"));
}

function writeGarbage(file, extras = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, extras.body || "this is not a sqlite database\n");
  if (extras.wal) fs.writeFileSync(`${file}-wal`, extras.wal);
  if (extras.shm) fs.writeFileSync(`${file}-shm`, extras.shm);
}

function corruptCopies(file) {
  const base = path.basename(file);
  const dir = path.dirname(file);
  return fs.readdirSync(dir).filter((n) => n.startsWith(`${base}.corrupt.`));
}

describe("sql quarantine", () => {
  it("copies file, -wal, and -shm to .corrupt.<stamp> and leaves the originals", () => {
    const dir = tmpDir();
    const file = path.join(dir, "main.sqlite");
    writeGarbage(file, { wal: "wal-bytes", shm: "shm-bytes" });
    try {
      const q = quarantineSqlFile(file);
      assert.equal(fs.existsSync(file), true);
      assert.equal(fs.existsSync(`${file}-wal`), true);
      assert.equal(fs.existsSync(`${file}-shm`), true);
      assert.equal(fs.existsSync(q.dest), true);
      assert.equal(fs.existsSync(`${q.dest}-wal`), true);
      assert.equal(fs.existsSync(`${q.dest}-shm`), true);
      assert.equal(fs.readFileSync(q.dest, "utf8"), fs.readFileSync(file, "utf8"));
      assert.equal(fs.readFileSync(`${q.dest}-wal`, "utf8"), "wal-bytes");
      assert.equal(fs.readFileSync(`${q.dest}-shm`, "utf8"), "shm-bytes");
      assert.match(q.stamp, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(q.copies.length, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips missing sidecars and still does not delete the file", () => {
    const dir = tmpDir();
    const file = path.join(dir, "solo.sqlite");
    writeGarbage(file);
    try {
      const q = quarantineSqlFile(file);
      assert.equal(fs.existsSync(file), true);
      assert.equal(fs.existsSync(q.dest), true);
      assert.equal(fs.existsSync(`${q.dest}-wal`), false);
      assert.equal(fs.existsSync(`${q.dest}-shm`), false);
      assert.equal(q.copies.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("openControlPlane on NOTADB copies then throws; original stays; no reopen", () => {
    const dir = tmpDir();
    const file = path.join(dir, "control.sqlite");
    writeGarbage(file, { wal: "w", shm: "s" });
    const cfg = { paths: { controlPlaneFile: file, stateDir: dir } };
    try {
      assert.throws(() => openControlPlane(cfg), /not a database/i);
      assert.equal(fs.existsSync(file), true);
      assert.equal(corruptCopies(file).length, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getControlPlane does not loop-reopen a corrupt control file", () => {
    const dir = tmpDir();
    const file = path.join(dir, "control.sqlite");
    writeGarbage(file);
    const cfg = { paths: { controlPlaneFile: file, stateDir: dir } };
    stopControlPlane();
    try {
      assert.throws(() => getControlPlane(cfg), /not a database/i);
      const afterFirst = corruptCopies(file).length;
      assert.equal(afterFirst, 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      assert.throws(() => getControlPlane(cfg), /not a database/i);
      assert.equal(corruptCopies(file).length, afterFirst);
      assert.equal(fs.existsSync(file), true);
    } finally {
      stopControlPlane();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("openMemoryIndex on NOTADB copies then throws; original stays", () => {
    const dir = tmpDir();
    const file = path.join(dir, "main.sqlite");
    writeGarbage(file);
    const cfg = { paths: { memoryIndexFile: file, memoryDir: dir } };
    try {
      assert.throws(() => openMemoryIndex(cfg), /not a database/i);
      assert.equal(fs.existsSync(file), true);
      assert.equal(corruptCopies(file).length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schema refuse is not corruption and does not quarantine", () => {
    const dir = tmpDir();
    const file = path.join(dir, "control.sqlite");
    const kit = openKit(file, { label: "seed" });
    kit.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, version INTEGER NOT NULL, touched_at TEXT NOT NULL);
    `);
    kit.prepare("INSERT INTO schema_meta(key, version, touched_at) VALUES (?, ?, ?)").run(
      "control",
      99,
      new Date().toISOString(),
    );
    kit.close();
    const cfg = { paths: { controlPlaneFile: file, stateDir: dir } };
    try {
      assert.throws(() => openControlPlane(cfg), (err) => err.code === "XCLAW_SCHEMA_NEWER");
      assert.equal(corruptCopies(file).length, 0);
      assert.equal(fs.existsSync(file), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("probeSqlFile: missing is info, healthy is ok, NOTADB is error, no .corrupt copy", () => {
    const dir = tmpDir();
    const missing = path.join(dir, "absent.sqlite");
    const healthy = path.join(dir, "ok.sqlite");
    const bad = path.join(dir, "bad.sqlite");
    const kit = openKit(healthy, { label: "ok" });
    kit.exec("CREATE TABLE t(id INTEGER)");
    kit.close();
    writeGarbage(bad);
    const checks = [];
    const push = (id, status, message) => checks.push({ id, status, message });
    try {
      probeSqlFile(push, "sql.missing", missing);
      probeSqlFile(push, "sql.ok", healthy);
      probeSqlFile(push, "sql.bad", bad);
      assert.deepEqual(checks[0], { id: "sql.missing", status: "info", message: "not created yet" });
      assert.equal(checks[1].id, "sql.ok");
      assert.equal(checks[1].status, "ok");
      assert.equal(checks[1].message, healthy);
      assert.equal(checks[2].id, "sql.bad");
      assert.equal(checks[2].status, "error");
      assert.match(checks[2].message, /corrupt/i);
      assert.equal(corruptCopies(bad).length, 0);
      assert.equal(fs.existsSync(bad), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lock is busy (warn), not corruption (error)", () => {
    const lock = { code: "SQLITE_BUSY", errcode: 5, message: "database is locked" };
    const corrupt = { code: "ERR_SQLITE_ERROR", errcode: 26, message: "file is not a database" };
    const file = "/tmp/held.sqlite";
    const busy = classifySqlProbe(lock, file);
    const bad = classifySqlProbe(corrupt, file);
    assert.equal(busy.status, "warn");
    assert.match(busy.message, /busy/i);
    assert.equal(bad.status, "error");
    assert.match(bad.message, /corrupt/i);
  });

  it("notADatabaseError: missing, empty, and real SQLite files are not errors", () => {
    const dir = tmpDir();
    const missing = path.join(dir, "absent.sqlite");
    const empty = path.join(dir, "empty.sqlite");
    const real = path.join(dir, "real.sqlite");
    const bad = path.join(dir, "bad.sqlite");
    fs.writeFileSync(empty, "");
    const kit = openKit(real, { label: "real" });
    kit.exec("CREATE TABLE t(id INTEGER)");
    kit.close();
    writeGarbage(bad);
    try {
      assert.equal(notADatabaseError(missing), null);
      assert.equal(notADatabaseError(empty), null);
      assert.equal(notADatabaseError(real), null);
      const err = notADatabaseError(bad);
      assert.match(err.message, /not a database/i);
      assert.equal(err.errcode & 0xff, 26);
      assert.equal(corruptCopies(bad).length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The header peek exists so the sidecars survive: SQLite's own failed open
   * can unlink -wal/-shm before quarantine runs (1 in 300 under CPU load),
   * and a -wal holds committed-but-uncheckpointed rows. Every opener that
   * quarantines must refuse before SQLite ever touches the file.
   */
  for (const opener of [
    {
      name: "openControlPlane",
      file: (dir) => path.join(dir, "control.sqlite"),
      open: (dir, file) => openControlPlane({ paths: { controlPlaneFile: file, stateDir: dir } }),
    },
    {
      name: "openMemoryIndex",
      file: (dir) => path.join(dir, "main.sqlite"),
      open: (dir, file) => openMemoryIndex({ paths: { memoryIndexFile: file, memoryDir: dir } }),
    },
    {
      name: "openAgentStore",
      file: (dir) => path.join(dir, "a1", "agent.sqlite"),
      open: (dir) => openAgentStore("a1", { paths: { agentDir: dir } }),
    },
  ]) {
    it(`${opener.name} keeps -wal and -shm when it refuses a non-database`, () => {
      const dir = tmpDir();
      const file = opener.file(dir);
      writeGarbage(file, { wal: "wal-bytes", shm: "shm-bytes" });
      try {
        // The path in the message is the pre-open guard's signature: SQLite's
        // own refusal is the bare "file is not a database". Asserting it here
        // is what pins the guard, because the sidecar loss it prevents is a
        // race that only lands ~1 run in 300, and only under CPU load.
        assert.throws(() => opener.open(dir, file), (err) => err.message.includes(file));
        assert.equal(fs.existsSync(file), true);
        assert.equal(fs.existsSync(`${file}-wal`), true);
        assert.equal(fs.existsSync(`${file}-shm`), true);
        assert.equal(corruptCopies(file).length, 3);
        const stamped = corruptCopies(file).find((n) => n.endsWith("-wal"));
        assert.equal(fs.readFileSync(path.join(path.dirname(file), stamped), "utf8"), "wal-bytes");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("default doctor reports sql.control and sql.memory and does not --fix", async () => {
    const dir = tmpDir();
    const configDir = path.join(dir, ".xclaw");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "xclaw.json"),
      JSON.stringify({ profile: "lab", agent: { apiKey: "test-key" } }, null, 2) + "\n",
    );
    const prevHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      const { runDoctor } = await import("../src/cli/doctor.mjs");
      const report = await runDoctor({ json: true, quiet: true });
      const ids = report.checks.map((c) => c.id);
      assert.equal(ids.includes("sql.control"), true);
      assert.equal(ids.includes("sql.memory"), true);
      assert.equal(ids.includes("fix.cron"), false);
      assert.equal(ids.includes("fix.pairing"), false);
      const mem = report.checks.find((c) => c.id === "sql.memory");
      assert.equal(mem.status, "info");
      assert.equal(mem.message, "not created yet");
    } finally {
      process.env.HOME = prevHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
