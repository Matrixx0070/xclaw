/**
 * SSH Certificate Authority helpers (user & host certs).
 *
 * Does not replace OpenSSH: wraps ssh-keygen for inspect/sign workflows
 * and generates recommended sshd / ssh_config snippets.
 *
 * Typical flow:
 *   1. Generate CA keypair (offline, high protection)
 *   2. Sign user/host keys with CA → *.pub certificates
 *   3. Servers trust CA via TrustedUserCAKeys / TrustedUserCAKeys
 *   4. Clients trust host CA via @cert-authority known_hosts
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr })
    );
    child.on("error", (err) =>
      resolve({ code: 1, stdout, stderr: err.message })
    );
  });
}

/**
 * Parse `ssh-keygen -L -f cert` human output into structured fields.
 * @param {string} text
 */
export function parseSshCertificateListing(text) {
  const out = {
    type: null,
    publicKey: null,
    signingCA: null,
    keyId: null,
    serial: null,
    validAfter: null,
    validBefore: null,
    principals: [],
    extensions: [],
    criticalOptions: [],
    raw: text,
  };
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (/^Type:/.test(t)) out.type = t.replace(/^Type:\s*/, "");
    else if (/^Public key:/.test(t)) out.publicKey = t.replace(/^Public key:\s*/, "");
    else if (/^Signing CA:/.test(t)) out.signingCA = t.replace(/^Signing CA:\s*/, "");
    else if (/^Key ID:/.test(t)) out.keyId = t.replace(/^Key ID:\s*/, "");
    else if (/^Serial:/.test(t)) out.serial = t.replace(/^Serial:\s*/, "");
    else if (/^Valid:/.test(t)) {
      const m = t.match(/from\s+(.+?)\s+to\s+(.+)$/i);
      if (m) {
        out.validAfter = m[1].trim();
        out.validBefore = m[2].trim();
      }
    } else if (/^Principals:/.test(t)) {
      /* following lines indented */
    } else if (out.validBefore && /^\s+\S/.test(line) && !out.principals.length) {
      // principals block — simplistic: collect indented lines after Principals
    }
  }
  // Principals: collect lines after "Principals:" until blank or next section
  const lines = String(text).split("\n");
  let mode = null;
  for (const line of lines) {
    if (/^\s*Principals:\s*$/.test(line)) {
      mode = "principals";
      continue;
    }
    if (/^\s*Critical Options:\s*$/.test(line)) {
      mode = "critical";
      continue;
    }
    if (/^\s*Extensions:\s*$/.test(line)) {
      mode = "extensions";
      continue;
    }
    if (/^\S/.test(line) && mode) {
      mode = null;
    }
    if (mode === "principals" && line.trim()) out.principals.push(line.trim());
    if (mode === "critical" && line.trim()) out.criticalOptions.push(line.trim());
    if (mode === "extensions" && line.trim()) out.extensions.push(line.trim());
  }
  return out;
}

/**
 * Inspect an OpenSSH certificate file (-cert.pub).
 * @param {string} certPath
 */
export async function inspectSshCertificate(certPath) {
  const r = await run("ssh-keygen", ["-L", "-f", certPath]);
  if (r.code !== 0) {
    return {
      ok: false,
      code: "SSH_CERT_INSPECT_FAILED",
      error: r.stderr || r.stdout || "ssh-keygen -L failed",
    };
  }
  const parsed = parseSshCertificateListing(r.stdout);
  let expired = false;
  let expiresSoon = false;
  if (parsed.validBefore) {
    const end = Date.parse(parsed.validBefore);
    if (!Number.isNaN(end)) {
      const now = Date.now();
      expired = now > end;
      expiresSoon = !expired && end - now < 7 * 24 * 3600 * 1000;
    }
  }
  return {
    ok: true,
    path: certPath,
    certificate: parsed,
    expired,
    expiresSoon,
  };
}

/**
 * Sign a public key with a CA private key (user or host cert).
 *
 * @param {object} opts
 * @param {string} opts.caKey - path to CA private key
 * @param {string} opts.publicKey - path to id_*.pub to sign
 * @param {string[]} opts.principals - user names or hostnames
 * @param {'user'|'host'} [opts.certType]
 * @param {string} [opts.identity] - key identity string
 * @param {string} [opts.validity] - e.g. +52w, -1d:+1h
 * @param {string} [opts.serial]
 * @param {string[]} [opts.extensions] - e.g. permit-pty
 */
export async function signSshCertificate(opts) {
  const {
    caKey,
    publicKey,
    principals = [],
    certType = "user",
    identity = "xclaw",
    validity = "+52w",
    serial,
    extensions,
  } = opts;

  if (!caKey || !publicKey) {
    return {
      ok: false,
      code: "SSH_CA_ARGS",
      error: "caKey and publicKey are required",
    };
  }
  if (!principals.length) {
    return {
      ok: false,
      code: "SSH_CA_PRINCIPALS",
      error: "at least one principal is required",
    };
  }

  const args = [
    "-s",
    caKey,
    "-I",
    identity,
    "-n",
    principals.join(","),
    "-V",
    validity,
  ];
  if (certType === "host") args.push("-h");
  if (serial != null) args.push("-z", String(serial));
  // Default user extensions if not host
  if (certType === "user") {
    const exts =
      extensions ||
      [
        "permit-X11-forwarding",
        "permit-agent-forwarding",
        "permit-port-forwarding",
        "permit-pty",
        "permit-user-rc",
      ];
    // OpenSSH: -O clear then -O permit-*
    args.push("-O", "clear");
    for (const e of exts) {
      args.push("-O", e);
    }
  }
  args.push(publicKey);

  const r = await run("ssh-keygen", args);
  if (r.code !== 0) {
    return {
      ok: false,
      code: "SSH_CA_SIGN_FAILED",
      error: r.stderr || r.stdout || "ssh-keygen -s failed",
    };
  }
  // Output cert is publicKey with -cert.pub suffix
  const certPath = publicKey.replace(/\.pub$/, "") + "-cert.pub";
  const inspect = await inspectSshCertificate(certPath);
  return {
    ok: true,
    certPath,
    inspect,
    stdout: r.stdout,
  };
}

/**
 * Generate sshd / client config snippets for a CA public key.
 * @param {{ caPublicKeyPath: string, mode: 'user'|'host' }} opts
 */
export function generateSshCaConfigSnippets(opts) {
  const { caPublicKeyPath, mode = "user" } = opts;
  const caPath = caPublicKeyPath || "/etc/ssh/ca.pub";

  if (mode === "host") {
    return {
      knownHosts: `@cert-authority * ${caPath.includes("/") ? "$(cat ca.pub content)" : "<CA_PUBLIC_KEY_LINE>"}`,
      knownHostsFileExample: `# ~/.ssh/known_hosts or /etc/ssh/ssh_known_hosts
@cert-authority *.example.com <paste-CA-public-key-line-here>
`,
      sshConfig: `# optional: prefer certs
# Host *.example.com
#   CertificateFile ~/.ssh/id_ed25519-cert.pub
`,
    };
  }

  return {
    sshdConfig: `# /etc/ssh/sshd_config.d/ca.conf
TrustedUserCAKeys ${caPath}
# Optional: revoke list
# RevokedKeys /etc/ssh/revoked_keys
# Optional: require cert principals
# AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u
`,
    clientConfig: `# ~/.ssh/config
Host *.example.com
  IdentityFile ~/.ssh/id_ed25519
  CertificateFile ~/.ssh/id_ed25519-cert.pub
  IdentitiesOnly yes
`,
    installCa: `# On each server:
# sudo cp ca.pub /etc/ssh/ca.pub
# sudo chmod 644 /etc/ssh/ca.pub
# add TrustedUserCAKeys and: sudo systemctl reload sshd
`,
  };
}

/**
 * Generate a new CA keypair (operator must protect private key offline).
 */
export async function generateSshCaKeypair(outDir, { type = "ed25519", name = "xclaw-ssh-ca" } = {}) {
  await fs.mkdir(outDir, { recursive: true });
  const keyPath = path.join(outDir, name);
  const r = await run("ssh-keygen", [
    "-t",
    type,
    "-f",
    keyPath,
    "-N",
    "", // empty passphrase — operator should re-protect offline
    "-C",
    name,
  ]);
  if (r.code !== 0) {
    return {
      ok: false,
      error: r.stderr || "ssh-keygen CA generate failed",
    };
  }
  return {
    ok: true,
    privateKey: keyPath,
    publicKey: keyPath + ".pub",
    warning:
      "CA private key created with empty passphrase for automation — move offline and protect immediately",
  };
}

/**
 * Doctor-style: look for CertificateFile entries / cert expiry in common paths.
 */
export async function sshCaStatus(homeDir) {
  const home = homeDir || process.env.HOME || "";
  const candidates = [
    path.join(home, ".ssh/id_ed25519-cert.pub"),
    path.join(home, ".ssh/id_rsa-cert.pub"),
    path.join(home, ".ssh/id_ecdsa-cert.pub"),
  ];
  const found = [];
  for (const p of candidates) {
    try {
      await fs.access(p);
      const ins = await inspectSshCertificate(p);
      found.push({ path: p, ...ins });
    } catch {
      /* missing */
    }
  }
  return {
    ok: true,
    certificates: found,
    anyExpired: found.some((f) => f.expired),
    anyExpiringSoon: found.some((f) => f.expiresSoon),
  };
}
