import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCredentialAttrs,
  formatCredentialAttrs,
  credentialDescriptionFromUrl,
  redactCredentialAttrs,
} from "../src/git/credential.mjs";

describe("credential protocol", () => {
  it("round-trips attrs", () => {
    const raw = formatCredentialAttrs({
      protocol: "https",
      host: "github.com",
      path: "org/repo.git",
    });
    assert.match(raw, /protocol=https/);
    const parsed = parseCredentialAttrs(raw);
    assert.equal(parsed.host, "github.com");
    assert.equal(parsed.path, "org/repo.git");
  });

  it("parses fill output", () => {
    const p = parseCredentialAttrs(
      "protocol=https\nhost=example.com\nusername=bob\npassword=s3cre7\n"
    );
    assert.equal(p.username, "bob");
    assert.equal(p.password, "s3cre7");
  });

  it("description from https URL", () => {
    const d = credentialDescriptionFromUrl("https://github.com/acme/app.git");
    assert.equal(d.ok, true);
    assert.equal(d.attrs.protocol, "https");
    assert.equal(d.attrs.host, "github.com");
    assert.match(d.attrs.path, /acme\/app/);
  });

  it("description from scp URL", () => {
    const d = credentialDescriptionFromUrl("git@github.com:acme/app.git");
    assert.equal(d.ok, true);
    assert.equal(d.attrs.protocol, "ssh");
    assert.equal(d.attrs.host, "github.com");
    assert.equal(d.attrs.username, "git");
  });

  it("redacts password", () => {
    const r = redactCredentialAttrs({ username: "a", password: "secret" });
    assert.equal(r.password, "***");
    assert.equal(r.username, "a");
  });
});
