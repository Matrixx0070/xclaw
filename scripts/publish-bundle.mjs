#!/usr/bin/env node
/**
 * Publish a new computer bundle atomically: update the manifest AND upload the
 * release asset in one step, so the sha256 in bundle-artifact.json can never
 * drift from what `npm run fetch:bundle` actually downloads.
 *
 * Steps:
 *   1. hash the local bundle (sha256 + bytes)
 *   2. `gh release upload --clobber` the asset to the manifest's release
 *   3. re-download it and verify the checksum matches what we hashed
 *   4. only then rewrite src/computer/bundle-artifact.json
 *
 * If the upload or the round-trip verify fails, the manifest is left untouched.
 *
 * Usage:
 *   node scripts/publish-bundle.mjs [path-to-bundle] [--repo owner/name] [--dry-run]
 * Default path: the manifest's `file` (src/computer/xclaw-server.mjs).
 * Exit: 0 ok, 1 failure, 2 usage.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "src/computer/bundle-artifact.json");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const repoIdx = argv.indexOf("--repo");
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--repo");

function log(m) {
  console.log(`[publish:bundle] ${m}`);
}
function die(m, code = 1) {
  console.error(`[publish:bundle] FAIL: ${m}`);
  process.exit(code);
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(manifestPath)) die(`manifest missing: ${manifestPath}`, 2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Repo: --repo flag, else derive from the manifest URL.
let repo = repoIdx >= 0 ? argv[repoIdx + 1] : null;
if (!repo) {
  const m = /github\.com\/([^/]+\/[^/]+)\/releases/.exec(manifest.url || "");
  repo = m ? m[1] : null;
}
if (!repo) die("could not determine repo (pass --repo owner/name)", 2);

const bundlePath = path.resolve(root, positional[0] || manifest.file);
if (!fs.existsSync(bundlePath)) {
  die(`bundle not found: ${bundlePath}\n  build/obtain it first, or pass the path explicitly`);
}

const bytes = fs.statSync(bundlePath).size;
const digest = sha256(bundlePath);
log(`bundle: ${path.relative(root, bundlePath)} (${bytes} bytes, sha256 ${digest.slice(0, 16)}…)`);

if (digest === manifest.sha256 && bytes === manifest.bytes) {
  log("manifest already matches this bundle — nothing to publish");
  process.exit(0);
}

if (dryRun) {
  log(`DRY RUN — would upload ${manifest.asset} to release "${manifest.release}" (${repo})`);
  log(`DRY RUN — would set manifest bytes=${bytes} sha256=${digest}`);
  process.exit(0);
}

// The asset name on the release must match manifest.asset. Upload with a temp
// copy named exactly manifest.asset so the release keeps a stable filename.
const stageDir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "xclaw-bundle-"));
const staged = path.join(stageDir, manifest.asset);
fs.copyFileSync(bundlePath, staged);

log(`uploading ${manifest.asset} → release "${manifest.release}" (${repo})…`);
const up = spawnSync(
  "gh",
  ["release", "upload", manifest.release, staged, "--repo", repo, "--clobber"],
  { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] }
);
if (up.status !== 0) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  die(`gh release upload failed (status ${up.status}). Is the release "${manifest.release}" created and are you authenticated?`);
}

// Round-trip verify: download what we just uploaded and confirm the hash.
log("verifying the uploaded asset round-trips to the same checksum…");
const verifyPath = path.join(stageDir, "verify.bin");
const dl = spawnSync(
  "gh",
  ["release", "download", manifest.release, "--repo", repo, "--pattern", manifest.asset, "--clobber", "-O", verifyPath],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);
if (dl.status !== 0 || !fs.existsSync(verifyPath)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  die("could not re-download the asset to verify — manifest NOT updated");
}
const roundtrip = sha256(verifyPath);
if (roundtrip !== digest) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  die(`round-trip checksum mismatch (uploaded ${digest.slice(0, 16)}…, downloaded ${roundtrip.slice(0, 16)}…) — manifest NOT updated`);
}
fs.rmSync(stageDir, { recursive: true, force: true });

// Only now rewrite the manifest, preserving key order + trailing newline.
manifest.bytes = bytes;
manifest.sha256 = digest;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
log(`manifest updated: bytes=${bytes} sha256=${digest}`);
log("done — commit src/computer/bundle-artifact.json to record the new bundle.");
