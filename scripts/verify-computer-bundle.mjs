#!/usr/bin/env node
/**
 * Offline-friendly CDP bundle integrity check.
 *
 * Always (no network):
 *   - sha256 + bytes vs src/computer/bundle-artifact.json
 *
 * Optional Cosign (offline when materials exist):
 *   - cosign verify-blob with --bundle and optional --trusted-root
 *   - requires `cosign` on PATH and a .sigstore.json next to the blob (or path in manifest)
 *
 * Usage:
 *   node scripts/verify-computer-bundle.mjs
 *   node scripts/verify-computer-bundle.mjs --require-sigstore
 *   node scripts/verify-computer-bundle.mjs --trusted-root /path/to/trusted_root.json
 *
 * Exit: 0 ok, 1 usage/config, 2 integrity fail, 3 sigstore fail
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "src/computer/bundle-artifact.json");

const args = process.argv.slice(2);
const requireSigstore = args.includes("--require-sigstore");
const rootIdx = args.indexOf("--trusted-root");
const trustedRoot = rootIdx >= 0 ? args[rootIdx + 1] : process.env.XCLAW_SIGSTORE_TRUSTED_ROOT || null;

function log(m) {
  console.log(`[verify:bundle] ${m}`);
}
function fail(m, code) {
  console.error(`[verify:bundle] FAIL: ${m}`);
  process.exit(code);
}

if (!fs.existsSync(manifestPath)) fail(`manifest missing: ${manifestPath}`, 1);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const bundlePath = path.join(root, manifest.file);

if (!fs.existsSync(bundlePath)) {
  fail(
    `bundle missing: ${bundlePath}\n  Run: npm run fetch:bundle  (or copy a verified artifact)`,
    2
  );
}

const buf = fs.readFileSync(bundlePath);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
const bytesOk = buf.length === manifest.bytes;
const shaOk = sha256 === manifest.sha256;

log(`file: ${manifest.file}`);
log(`bytes: actual=${buf.length} expected=${manifest.bytes} ${bytesOk ? "OK" : "MISMATCH"}`);
log(`sha256: ${shaOk ? "OK" : "MISMATCH"}`);
if (!shaOk) {
  log(`  actual:   ${sha256}`);
  log(`  expected: ${manifest.sha256}`);
}

if (!bytesOk || !shaOk) {
  fail("content integrity check failed (offline hash)", 2);
}

log("offline content integrity: PASSED");

// --- optional sigstore ---
const sigstoreRel =
  manifest.sigstore?.bundle ||
  `${manifest.file}.sigstore.json`;
const sigstorePath = path.isAbsolute(sigstoreRel)
  ? sigstoreRel
  : path.join(root, sigstoreRel);

const hasSigstore = fs.existsSync(sigstorePath);
const cosign = spawnSync("cosign", ["version"], { encoding: "utf8" });
const hasCosign = cosign.status === 0;

if (!hasSigstore) {
  log(`sigstore bundle: absent (${path.relative(root, sigstorePath)})`);
  if (requireSigstore) {
    fail(
      "sigstore required but .sigstore.json not found — publish workflow must sign-blob first",
      3
    );
  }
  log("sigstore: SKIP (hash-only offline verify)");
  process.exit(0);
}

if (!hasCosign) {
  log("cosign: not on PATH");
  if (requireSigstore) {
    fail("sigstore required but cosign binary not installed", 3);
  }
  log("sigstore: SKIP (install cosign for signature verify)");
  process.exit(0);
}

const identity =
  manifest.sigstore?.certificateIdentity ||
  process.env.XCLAW_COSIGN_IDENTITY ||
  null;
const identityRegexp =
  manifest.sigstore?.certificateIdentityRegexp ||
  process.env.XCLAW_COSIGN_IDENTITY_REGEXP ||
  "^https://github.com/Matrixx0070/xclaw/\\.github/workflows/.*";
const oidcIssuer =
  manifest.sigstore?.certificateOidcIssuer ||
  process.env.XCLAW_COSIGN_OIDC_ISSUER ||
  "https://token.actions.githubusercontent.com";

const verifyArgs = [
  "verify-blob",
  bundlePath,
  "--bundle",
  sigstorePath,
  "--certificate-oidc-issuer",
  oidcIssuer,
];
if (identity) {
  verifyArgs.push("--certificate-identity", identity);
} else {
  verifyArgs.push("--certificate-identity-regexp", identityRegexp);
}
if (trustedRoot) {
  if (!fs.existsSync(trustedRoot)) fail(`trusted root missing: ${trustedRoot}`, 1);
  verifyArgs.push("--trusted-root", trustedRoot);
  log(`trusted-root: ${trustedRoot} (offline-oriented)`);
} else {
  log(
    "trusted-root: not set — cosign may fetch public-good roots (needs network unless pre-cached)"
  );
}

log(`running: cosign ${verifyArgs.join(" ")}`);
const vr = spawnSync("cosign", verifyArgs, { encoding: "utf8" });
if (vr.stdout) process.stdout.write(vr.stdout);
if (vr.stderr) process.stderr.write(vr.stderr);
if (vr.status !== 0) {
  fail("cosign verify-blob failed", 3);
}

log("sigstore verify: PASSED");
process.exit(0);
