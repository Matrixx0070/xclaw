#!/usr/bin/env node
/**
 * Fetch the full-CDP computer bundle from its GitHub release.
 *
 * The 16MB `src/computer/xclaw-server.mjs` is NOT tracked in git. Required when
 * XCLAW_COMPUTER_ENGINE=bundle (product default).
 *
 * Integrity: sha256 in `src/computer/bundle-artifact.json`.
 *
 * Transport order:
 *   1) gh release download (API + auth)
 *   2) GitHub Releases API with GH_TOKEN / GITHUB_TOKEN (private repos)
 *   3) direct public release URL
 *   4) local sibling copies matching sha256
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
const REPO = "Matrixx0070/xclaw";

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

function githubToken() {
  return (
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.XCLAW_GITHUB_TOKEN ||
    ""
  );
}

if (!fs.existsSync(manifestPath)) die(`manifest missing: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const dest = path.join(root, manifest.file);

if (!force && fs.existsSync(dest)) {
  const have = sha256(dest);
  if (have === manifest.sha256) {
    log(`already present and verified (${manifest.file})`);
    process.exit(0);
  }
  log(
    `present but checksum mismatch (${have.slice(0, 12)} != ${manifest.sha256.slice(0, 12)}) — refetching`
  );
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

function tryGh() {
  const gh = spawnSync(
    "gh",
    [
      "release",
      "download",
      manifest.release,
      "--repo",
      REPO,
      "--pattern",
      manifest.asset,
      "--clobber",
      "-O",
      tmp,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return gh.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0;
}

/** Private-repo friendly: Releases API + Accept: application/octet-stream */
async function tryGithubApi() {
  const token = githubToken();
  if (!token) return false;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "xclaw-fetch-bundle",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const relRes = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(manifest.release)}`,
    { headers }
  );
  if (!relRes.ok) {
    log(`github api release lookup HTTP ${relRes.status}`);
    return false;
  }
  const rel = await relRes.json();
  const asset = (rel.assets || []).find((a) => a.name === manifest.asset);
  if (!asset?.id) {
    log(`github api: asset ${manifest.asset} not on release ${manifest.release}`);
    return false;
  }
  const dl = await fetch(
    `https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
        "User-Agent": "xclaw-fetch-bundle",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
    }
  );
  if (!dl.ok) {
    log(`github api asset download HTTP ${dl.status}`);
    return false;
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  if (!buf.length) return false;
  fs.writeFileSync(tmp, buf);
  return true;
}

async function tryUrl() {
  const res = await fetch(manifest.url, { redirect: "follow" });
  if (!res.ok) {
    log(`direct URL HTTP ${res.status} (private repo returns 404 without auth)`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return true;
}

function tryLocal() {
  const candidates = [
    path.join(root, "..", "xclaw", "src", "computer", "xclaw-server.mjs"),
    path.join(root, "..", "xclaw-server.mjs"),
    path.join(root, "artifacts", "xclaw-server.mjs"),
    path.join("/tmp", "xclaw-server-dl.mjs"),
  ];
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const h = sha256(c);
      if (h !== manifest.sha256) {
        log(`local candidate skip (checksum): ${c}`);
        continue;
      }
      fs.copyFileSync(c, tmp);
      log(`copied from local verified path: ${c}`);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

log(`fetching ${manifest.asset} from release "${manifest.release}"…`);
let ok = false;
try {
  ok = tryGh();
  if (ok) log("downloaded via gh");
} catch {
  /* gh missing */
}
if (!ok) {
  try {
    ok = await tryGithubApi();
    if (ok) log("downloaded via GitHub API (token)");
  } catch (err) {
    log(`github api error: ${err.message || err}`);
  }
}
if (!ok) {
  try {
    ok = await tryUrl();
    if (ok) log("downloaded via direct URL");
  } catch (err) {
    log(`direct URL error: ${err.message || err}`);
  }
}
if (!ok) {
  ok = tryLocal();
}
if (!ok) {
  die(
    `could not download the bundle.\n` +
      `  Private repo: set GH_TOKEN or GITHUB_TOKEN and retry.\n` +
      `  Or: gh auth login && gh release download ${manifest.release} --repo ${REPO} --pattern ${manifest.asset}\n` +
      `  Or copy a sha256-verified file to ${dest}\n` +
      `  Expected sha256: ${manifest.sha256}`
  );
}
verifyAndInstall();
