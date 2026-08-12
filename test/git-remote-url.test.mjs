import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateGitRemoteUrl,
  validateGitRemotes,
  parseGitRemoteV,
} from "../src/git/remote-url.mjs";

describe("validateGitRemoteUrl", () => {
  it("accepts https", () => {
    const v = validateGitRemoteUrl("https://github.com/org/repo.git");
    assert.equal(v.ok, true);
    assert.equal(v.scheme, "https");
    assert.equal(v.host, "github.com");
  });

  it("accepts ssh scp form", () => {
    const v = validateGitRemoteUrl("git@github.com:org/repo.git");
    assert.equal(v.ok, true);
    assert.equal(v.scheme, "scp");
    assert.equal(v.host, "github.com");
  });

  it("accepts ssh://", () => {
    const v = validateGitRemoteUrl("ssh://git@github.com/org/repo.git");
    assert.equal(v.ok, true);
    assert.equal(v.scheme, "ssh");
  });

  it("rejects empty", () => {
    const v = validateGitRemoteUrl("  ");
    assert.equal(v.ok, false);
    assert.equal(v.code, "REMOTE_URL_EMPTY");
  });

  it("rejects http by default", () => {
    const v = validateGitRemoteUrl("http://github.com/org/repo.git");
    assert.equal(v.ok, false);
    assert.equal(v.code, "REMOTE_URL_HTTP_DENIED");
  });

  it("allows http when opted in", () => {
    const v = validateGitRemoteUrl("http://github.com/org/repo.git", {
      allowHttp: true,
    });
    assert.equal(v.ok, true);
    assert.ok(v.warnings?.length);
  });

  it("rejects git:// by default", () => {
    const v = validateGitRemoteUrl("git://github.com/org/repo.git");
    assert.equal(v.ok, false);
    assert.equal(v.code, "REMOTE_URL_GIT_PROTOCOL_DENIED");
  });

  it("rejects dangerous schemes", () => {
    const v = validateGitRemoteUrl("javascript:alert(1)");
    assert.equal(v.ok, false);
  });

  it("enforces host allowlist", () => {
    const v = validateGitRemoteUrl("https://evil.example/repo.git", {
      allowedHosts: ["github.com"],
    });
    assert.equal(v.ok, false);
    assert.equal(v.code, "REMOTE_URL_HOST_NOT_ALLOWED");
  });

  it("allows subdomain of allowlist host", () => {
    const v = validateGitRemoteUrl("https://gitlab.mycorp.com/a/b.git", {
      allowedHosts: ["mycorp.com"],
    });
    assert.equal(v.ok, true);
  });
});

describe("validateGitRemotes + parse", () => {
  it("parses git remote -v", () => {
    const rows = parseGitRemoteV(
      "origin\thttps://github.com/a/b.git (fetch)\norigin\thttps://github.com/a/b.git (push)\n"
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, "origin");
  });

  it("aggregates validation", () => {
    const r = validateGitRemotes({
      origin: "https://github.com/a/b.git",
      bad: "http://x.com/y.git",
    });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
  });
});
