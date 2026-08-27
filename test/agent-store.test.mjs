/**
 * Per-agent file (spec §11.13).
 * Pins: path helper, open creates transcript_events + session_heads,
 * cache by agent id (same handle), stop walks the cache and closes,
 * gateway stop next to stopControlPlane, gateway start does not open.
 * Control plane stays global. Do not move live transcripts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENT_SCHEMA_VERSION,
  agentStoreFile,
  getAgentStore,
  openAgentStore,
  stopAgentStores,
} from "../src/state/agent-store.mjs";

function tmpCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-agent-"));
  return {
    dir,
    cfg: {
      paths: {
        agentDir: path.join(dir, "agents"),
      },
    },
  };
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
}

describe("agent store (spec §11.13)", () => {
  it("agentStoreFile uses cfg.paths.agentDir / <id>/agent.sqlite", () => {
    const { dir, cfg } = tmpCfg();
    try {
      assert.equal(
        agentStoreFile("main", cfg),
        path.join(dir, "agents", "main", "agent.sqlite"),
      );
      const home = agentStoreFile("main", {});
      assert.equal(home, path.join(os.homedir(), ".xclaw", "agents", "main", "agent.sqlite"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("agentStoreFile refuses empty, dot, and path-separator ids", () => {
    assert.throws(() => agentStoreFile("", {}), /invalid agent id/);
    assert.throws(() => agentStoreFile(".", {}), /invalid agent id/);
    assert.throws(() => agentStoreFile("..", {}), /invalid agent id/);
    assert.throws(() => agentStoreFile("a/b", {}), /invalid agent id/);
    assert.throws(() => agentStoreFile("a\\b", {}), /invalid agent id/);
  });

  it("openAgentStore creates transcript_events and session_heads", () => {
    const { dir, cfg } = tmpCfg();
    const kit = openAgentStore("main", cfg);
    try {
      const names = tableNames(kit.db);
      assert.ok(names.includes("transcript_events"));
      assert.ok(names.includes("session_heads"));
      const idx = kit
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
        .get("transcript_session");
      assert.equal(idx.name, "transcript_session");
      const file = agentStoreFile("main", cfg);
      assert.equal(fs.existsSync(file), true);
      kit
        .prepare(
          "INSERT INTO transcript_events(session_key, kind, payload, at) VALUES (?, ?, ?, ?)",
        )
        .run("s1", "user", "{}", new Date().toISOString());
      kit
        .prepare(
          "INSERT INTO session_heads(session_key, agent, last_seq, touched_at) VALUES (?, ?, ?, ?)",
        )
        .run("s1", "main", 1, new Date().toISOString());
      const ev = kit.prepare("SELECT COUNT(*) AS n FROM transcript_events").get();
      const hd = kit.prepare("SELECT last_seq FROM session_heads WHERE session_key = ?").get("s1");
      assert.equal(ev.n, 1);
      assert.equal(hd.last_seq, 1);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getAgentStore caches one handle per id; stopAgentStores closes all", () => {
    const { dir, cfg } = tmpCfg();
    stopAgentStores();
    try {
      const a = getAgentStore("main", cfg);
      const b = getAgentStore("main", cfg);
      assert.equal(a, b);
      assert.equal(a.db.isOpen, true);
      const other = getAgentStore("other", cfg);
      assert.notEqual(other, a);
      assert.equal(other.db.isOpen, true);
      stopAgentStores();
      assert.equal(a.db.isOpen, false);
      assert.equal(other.db.isOpen, false);
      const c = getAgentStore("main", cfg);
      assert.notEqual(c, a);
      assert.equal(c.db.isOpen, true);
      stopAgentStores();
    } finally {
      stopAgentStores();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cache is a Map keyed by agent id; stop walks and kit.close()", () => {
    const src = fs.readFileSync(
      new URL("../src/state/agent-store.mjs", import.meta.url),
      "utf8",
    );
    const getFn = src.slice(src.indexOf("export function getAgentStore"));
    const getBody = getFn.slice(0, getFn.indexOf("\nexport function stopAgentStores"));
    assert.match(getBody, /stores\.get\(id\)/);
    assert.match(getBody, /stores\.set\(id, kit\)/);
    assert.match(getBody, /if \(hit\) return hit/);
    const stopFn = src.slice(src.indexOf("export function stopAgentStores"));
    assert.match(stopFn, /for \(const kit of stores\.values\(\)\)/);
    assert.match(stopFn, /kit\.close\(\)/);
    assert.match(stopFn, /stores\.clear\(\)/);
  });

  it("open writes the schema_meta marker at AGENT_SCHEMA_VERSION (spec §12.10)", () => {
    const { dir, cfg } = tmpCfg();
    const kit = openAgentStore("main", cfg);
    try {
      assert.equal(AGENT_SCHEMA_VERSION, 1);
      const row = kit
        .prepare("SELECT version, touched_at FROM schema_meta WHERE key = 'agent'")
        .get();
      assert.equal(row.version, AGENT_SCHEMA_VERSION);
      assert.ok(typeof row.touched_at === "string" && row.touched_at.length > 0);
      const src = fs.readFileSync(
        new URL("../src/state/agent-store.mjs", import.meta.url),
        "utf8",
      );
      const markFn = src.slice(src.indexOf("function markAgentSchema"));
      const markBody = markFn.slice(0, markFn.indexOf("\nfunction "));
      assert.match(markBody, /kit\.atomic\(/);
      assert.match(markBody, /ON CONFLICT\(key\) DO UPDATE SET touched_at = excluded\.touched_at/);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reopen touches touched_at only; a stored version is never bumped in place", () => {
    const { dir, cfg } = tmpCfg();
    const first = openAgentStore("main", cfg);
    first
      .prepare("UPDATE schema_meta SET version = 0, touched_at = 'then' WHERE key = 'agent'")
      .run();
    first.close();
    const second = openAgentStore("main", cfg);
    try {
      const row = second
        .prepare("SELECT version, touched_at FROM schema_meta WHERE key = 'agent'")
        .get();
      assert.equal(row.version, 0);
      assert.notEqual(row.touched_at, "then");
    } finally {
      second.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a NEWER stored agent schema; no quarantine copy for a version refuse", () => {
    const { dir, cfg } = tmpCfg();
    const first = openAgentStore("main", cfg);
    first
      .prepare("UPDATE schema_meta SET version = ? WHERE key = 'agent'")
      .run(AGENT_SCHEMA_VERSION + 1);
    first.close();
    try {
      assert.throws(() => openAgentStore("main", cfg), /newer than 1/);
      const entries = fs.readdirSync(path.join(dir, "agents", "main"));
      assert.equal(entries.some((n) => n.includes(".corrupt.")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("open creates the §12.6 VFS/artifacts/boards tables on the agent file", () => {
    const { dir, cfg } = tmpCfg();
    const kit = openAgentStore("main", cfg);
    try {
      const names = tableNames(kit.db);
      for (const t of [
        "agent_vfs_nodes",
        "agent_artifacts",
        "agent_boards",
        "agent_board_columns",
        "agent_board_cards",
        "agent_transcript_archive",
        "agent_heartbeat_outcomes",
      ]) {
        assert.ok(names.includes(t), `missing ${t}`);
      }
      kit
        .prepare(
          "INSERT INTO agent_vfs_nodes(path, kind, payload, bytes, touched_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("/notes/a.txt", "file", null, Buffer.from("blob-bytes"), new Date().toISOString());
      const row = kit.prepare("SELECT kind, bytes FROM agent_vfs_nodes WHERE path = ?").get("/notes/a.txt");
      assert.equal(row.kind, "file");
      assert.equal(Buffer.from(row.bytes).toString(), "blob-bytes");
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("§12.6 tables are additive on an existing agent file; data survives reopen", () => {
    const { dir, cfg } = tmpCfg();
    const first = openAgentStore("main", cfg);
    first
      .prepare("INSERT INTO transcript_events(session_key, kind, payload, at) VALUES (?, ?, ?, ?)")
      .run("s1", "user", "{}", new Date().toISOString());
    first.exec("DROP TABLE agent_boards");
    first.close();
    const second = openAgentStore("main", cfg);
    try {
      assert.ok(tableNames(second.db).includes("agent_boards"));
      assert.equal(second.prepare("SELECT COUNT(*) AS n FROM transcript_events").get().n, 1);
      assert.equal(
        second.prepare("SELECT version FROM schema_meta WHERE key = 'agent'").get().version,
        AGENT_SCHEMA_VERSION,
      );
    } finally {
      second.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gateway stop walks agent stores next to stopControlPlane; start does not open", () => {
    const src = fs.readFileSync(
      new URL("../src/gateway/index.mjs", import.meta.url),
      "utf8",
    );
    assert.match(src, /import \{ stopAgentStores \} from "\.\.\/state\/agent-store\.mjs"/);
    const stopCtrl = src.indexOf("stopControlPlane();");
    const stopAgent = src.indexOf("stopAgentStores();");
    assert.ok(stopCtrl > 0 && stopAgent > stopCtrl, "stopAgentStores must follow stopControlPlane");
    assert.equal(
      src.includes("getAgentStore("),
      false,
      "gateway start must not open a per-agent file",
    );
  });
});
