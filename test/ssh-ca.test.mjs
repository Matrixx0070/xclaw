import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSshCertificateListing,
  generateSshCaConfigSnippets,
} from "../src/git/ssh-ca.mjs";

describe("SSH CA helpers", () => {
  it("parses ssh-keygen -L style listing", () => {
    const sample = `
Type: ssh-ed25519-cert-v01@openssh.com user certificate
Public key: ED25519-CERT SHA256:abc
Signing CA: ED25519 SHA256:def
Key ID: "alice-laptop"
Serial: 1
Valid: from 2026-01-01T00:00:00 to 2027-01-01T00:00:00
Principals:
        alice
        ubuntu
Critical Options: (none)
Extensions:
        permit-pty
`;
    const p = parseSshCertificateListing(sample);
    assert.match(p.type || "", /user certificate/);
    assert.equal(p.keyId, '"alice-laptop"');
    assert.ok(p.principals.includes("alice"));
    assert.ok(p.extensions.some((e) => e.includes("permit-pty")));
  });

  it("generates sshd snippet for user CA", () => {
    const s = generateSshCaConfigSnippets({
      caPublicKeyPath: "/etc/ssh/ca.pub",
      mode: "user",
    });
    assert.match(s.sshdConfig, /TrustedUserCAKeys/);
    assert.match(s.clientConfig, /CertificateFile/);
  });

  it("generates host CA known_hosts guidance", () => {
    const s = generateSshCaConfigSnippets({ mode: "host" });
    assert.match(s.knownHostsFileExample, /@cert-authority/);
  });
});
