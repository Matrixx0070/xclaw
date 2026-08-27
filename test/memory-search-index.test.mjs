/**
 * Spec §11.5 + §11.8 — memory search index.
 * Separate file from control.sqlite. FTS5 when available; search falls
 * back to LIKE. upsertChunk replaces the FTS row so updates do not
 * duplicate hits. Not opened from the gateway.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  memoryIndexFile,
  openMemoryIndex,
  searchMemory,
  upsertChunk,
} from "../src/memory/search-index.mjs";

function tmpCfg(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-memidx-"));
  return {
    dir,
    cfg: {
      paths: {
        memoryDir: path.join(dir, "memory"),
        ...extra,
      },
    },
  };
}

function chunk(over = {}) {
  return {
    id: "c1",
    path: "notes.md",
    hash: "h1",
    text: "alpha bravo token",
    ...over,
  };
}

describe("memory search index", () => {
  it("opens a missing file with chunks + fts tables", () => {
    const { dir, cfg } = tmpCfg();
    const idx = openMemoryIndex(cfg);
    try {
      const file = memoryIndexFile(cfg);
      assert.equal(fs.existsSync(file), true);
      assert.equal(idx.fts, true);
      const names = idx.kit
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') OR type = 'table'")
        .all()
        .map((r) => r.name);
      for (const n of ["meta", "files", "chunks", "embed_cache", "chunks_fts"]) {
        assert.equal(names.includes(n), true, `missing ${n}`);
      }
    } finally {
      idx.kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upsert then MATCH search finds the chunk with rank", () => {
    const { dir, cfg } = tmpCfg();
    const idx = openMemoryIndex(cfg);
    try {
      upsertChunk(idx.kit, chunk());
      const hits = searchMemory(idx.kit, { q: "bravo" });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, "c1");
      assert.equal(hits[0].path, "notes.md");
      assert.equal(hits[0].text, "alpha bravo token");
      assert.equal(typeof hits[0].rank, "number");
    } finally {
      idx.kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upsert same id replaces the FTS row (one hit, new text)", () => {
    const { dir, cfg } = tmpCfg();
    const idx = openMemoryIndex(cfg);
    try {
      upsertChunk(idx.kit, chunk());
      upsertChunk(idx.kit, chunk({ text: "alpha charlie token", hash: "h2" }));
      const oldHits = searchMemory(idx.kit, { q: "bravo" });
      const newHits = searchMemory(idx.kit, { q: "charlie" });
      assert.equal(oldHits.length, 0);
      assert.equal(newHits.length, 1);
      assert.equal(newHits[0].id, "c1");
      assert.equal(newHits[0].text, "alpha charlie token");
    } finally {
      idx.kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("empty query returns []", () => {
    const { dir, cfg } = tmpCfg();
    const idx = openMemoryIndex(cfg);
    try {
      upsertChunk(idx.kit, chunk());
      assert.deepEqual(searchMemory(idx.kit, { q: "" }), []);
      assert.deepEqual(searchMemory(idx.kit, { q: "   " }), []);
      assert.deepEqual(searchMemory(idx.kit, {}), []);
    } finally {
      idx.kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("search falls back to LIKE when chunks_fts is missing", () => {
    const { dir, cfg } = tmpCfg();
    const idx = openMemoryIndex(cfg);
    try {
      upsertChunk(idx.kit, chunk());
      idx.kit.exec("DROP TABLE chunks_fts");
      const hits = searchMemory(idx.kit, { q: "bravo" });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, "c1");
      assert.equal(hits[0].rank, undefined);
    } finally {
      idx.kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("search falls back to LIKE when MATCH rejects the query", () => {
    const { dir, cfg } = tmpCfg();
    const idx = openMemoryIndex(cfg);
    try {
      upsertChunk(idx.kit, chunk({ text: "foo AND bar" }));
      const hits = searchMemory(idx.kit, { q: "AND" });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, "c1");
    } finally {
      idx.kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("memoryIndexFile honors paths.memoryIndexFile", () => {
    const { dir, cfg } = tmpCfg();
    cfg.paths.memoryIndexFile = path.join(dir, "custom.sqlite");
    const idx = openMemoryIndex(cfg);
    try {
      assert.equal(fs.existsSync(path.join(dir, "custom.sqlite")), true);
      assert.equal(fs.existsSync(path.join(dir, "memory", "main.sqlite")), false);
      assert.equal(memoryIndexFile(cfg), path.join(dir, "custom.sqlite"));
    } finally {
      idx.kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
