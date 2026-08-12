#!/usr/bin/env node
/**
 * Fetch the opt-in full-CDP computer bundle from its GitHub release.
 *
 * The 16MB `src/computer/xclaw-server.mjs` is NOT tracked in git (it is a build
 * artifact, 64% of repo size). It is only needed when running with
 * XCLAW_COMPUTER_ENGINE=bundle; the default native/generated engines don't use it.
 *
 * Integrity: the download is verified against sha256 in
 * `src/computer/bundle-artifact.json`. Transport: prefers `gh release download`
 * (API-backed, works with private repos + auth), falls back to the direct
 * release URL.
 *
 * Usage: node scripts/fetch-computer-bundle.mjs [--force]
 * Exit: 0 ok/already-present, 1 failure.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "src/computer/bundle-artifact.json");
const force = process.argv.includes("--force");

function log(m) {
  console.log(`[fetch:bundle] ${m}`);
}
function die(m) {
  console.error(`[fetch:bundle] FAIL: ${m}`);
  process.exit(1);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(manifestPath)) die(`manifest missing: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const dest = path.join(root, manifest.file);

// Already present + valid → skip (idempotent)
if (!force && fs.existsSync(dest)) {
  const have = sha256(dest);
  if (have === manifest.sha256) {
    log(`already present and verified (${manifest.file})`);
    process.exit(0);
  }
  log(`present but checksum mismatch (${have.slice(0, 12)} != ${manifest.sha256.slice(0, 12)}) — refetching`);
}

const tmp = `${dest}.download`;
fs.mkdirSync(path.dirname(dest), { recursive: true });

function verifyAndInstall() {
  const got = sha256(tmp);
  if (got !== manifest.sha256) {
    fs.rmSync(tmp, { force: true });
    die(`checksum mismatch after download: got ${got}, want ${manifest.sha256}`);
  }
  fs.renameSync(tmp, dest);
  log(`installed ${manifest.file} (${fs.statSync(dest).size} bytes, sha256 ok)`);
}

// 1) gh release download (preferred — API-backed, handles private + auth)
function tryGh() {
  const gh = spawnSync(
    "gh",
    [
      "release",
      "download",
      manifest.release,
      "--repo",
      "Matrixx0070/xclaw",
      "--pattern",
      manifest.asset,
      "--clobber",
      "-O",
      tmp,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return gh.status === 0 && fs.existsSync(tmp);
}

// 2) direct URL fallback
async function tryUrl() {
  const res = await fetch(manifest.url, { redirect: "follow" });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return true;
}

log(`fetching ${manifest.asset} from release "${manifest.release}"…`);
let ok = false;
try {
  ok = tryGh();
  if (ok) log("downloaded via gh");
} catch {
  /* gh not installed — fall through */
}
if (!ok) {
  try {
    ok = await tryUrl();
    if (ok) log("downloaded via direct URL");
  } catch (err) {
    die(`download failed: ${err.message}`);
  }
}
if (!ok) {
  die(
    `could not download the bundle. Install GitHub CLI (gh) and authenticate, or fetch manually:\n` +
      `  ${manifest.url}\n  → ${dest}`
  );
}
verifyAndInstall();
