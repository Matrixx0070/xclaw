/**
 * XClaw host runtime contract.
 *
 * Gateway persistence uses Node's bundled SQLite. That library is only
 * trustworthy on specific patched release lines. Odd Current (23) is out.
 *
 * Allowed hosts:
 *   22.22.3 ≤ v < 23
 *   24.15.0 ≤ v < 25
 *   25.9.0  ≤ v
 *
 * The engines string is the source of truth. Evaluation splits on || and
 * applies >=min <upper per clause (upper may be a major-only token).
 *
 * Bun (spec §11.1): if process.versions.bun is set, require Bun >= 1.4.0,
 * node:sqlite present, and the same SQLite WAL window. Node remains the
 * ship default. Do not add a Bun path to Docker/CI.
 */
import { libClearsWalResetWindow } from "../persist/sql-safety.mjs";

const LINE_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const ENGINE_CLAUSE_RE =
  /^\s*>=\s*v?(\d+\.\d+\.\d+)(?:\s+<\s*v?(\d+(?:\.\d+\.\d+)?))?\s*$/i;

export const HOST_ENGINE_RANGE =
  ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0";

export function readHostTriple(raw) {
  if (typeof raw !== "string") return null;
  const hit = LINE_RE.exec(raw.trim());
  if (!hit) return null;
  const triple = {
    major: Number(hit[1]),
    minor: Number(hit[2]),
    patch: Number(hit[3]),
  };
  if (![triple.major, triple.minor, triple.patch].every(Number.isSafeInteger)) {
    return null;
  }
  return triple;
}

function parseSemver(version) {
  if (!version) return null;
  if (/^\d+$/.test(version)) {
    return { major: Number(version), minor: 0, patch: 0 };
  }
  return readHostTriple(version.includes(".") && version.split(".").length === 2 ? `${version}.0` : version);
}

function isAtLeast(actual, floor) {
  if (actual.major !== floor.major) return actual.major > floor.major;
  if (actual.minor !== floor.minor) return actual.minor > floor.minor;
  return actual.patch >= floor.patch;
}

/** Same clause walk as a disjoint engines field: >=A.B.C <X[ .Y.Z] || ... */
export function hostSatisfiesEngine(version, engine) {
  const parsed = readHostTriple(version);
  if (!engine) return null;
  if (!parsed) return false;
  const clauses = engine.split("||");
  let satisfied = false;
  for (const clause of clauses) {
    const match = clause.match(ENGINE_CLAUSE_RE);
    if (!match) return null;
    const clauseMinimum = parseSemver(match[1] ?? null);
    const upperRaw = match[2];
    const upper = upperRaw
      ? parseSemver(upperRaw.includes(".") ? upperRaw : `${upperRaw}.0.0`)
      : null;
    if (!clauseMinimum || (upperRaw && !upper)) return null;
    if (isAtLeast(parsed, clauseMinimum) && (!upper || !isAtLeast(parsed, upper))) {
      satisfied = true;
    }
  }
  return satisfied;
}

export function describeHost(raw = process.versions.node) {
  const triple = readHostTriple(raw);
  const display = String(raw ?? "").replace(/^v/, "");
  if (!triple) {
    return {
      allowed: false,
      raw: String(raw ?? ""),
      detail: `Cannot parse Node version ${JSON.stringify(raw)}. Need ${HOST_ENGINE_RANGE}.`,
    };
  }
  const ok = hostSatisfiesEngine(raw, HOST_ENGINE_RANGE);
  if (ok === true) {
    return {
      allowed: true,
      raw: display,
      triple,
      band: `${triple.major}.x`,
    };
  }
  if (triple.major === 23) {
    return {
      allowed: false,
      raw: display,
      triple,
      detail: `Node ${triple.major} is a short-lived Current line and is blocked. Use 22.22.3+, 24.15.0+, or 25.9.0+.`,
    };
  }
  return {
    allowed: false,
    raw: display,
    triple,
    detail: `Node v${triple.major}.${triple.minor}.${triple.patch} is outside ${HOST_ENGINE_RANGE}.`,
  };
}

export function hostCompatBanner(info) {
  return [
    `xclaw refused to start on Node v${info.raw}`,
    info.detail,
    `Accepted range: ${HOST_ENGINE_RANGE}`,
    "The 23.x line is blocked on purpose.",
  ].join("\n");
}

export function refuseUnsupportedHost(raw = process.versions.node) {
  const info = describeHost(raw);
  if (info.allowed) return info;
  const err = new Error(hostCompatBanner(info));
  err.code = "XCLAW_HOST_REFUSED";
  throw err;
}

export function hostPasses(raw = process.versions.node) {
  return hostSatisfiesEngine(raw, HOST_ENGINE_RANGE) === true;
}

export const BUN_FLOOR = { major: 1, minor: 4, patch: 0 };

export function bunPasses(raw = process.versions.bun) {
  if (!raw) return false;
  const t = readHostTriple(raw);
  if (!t) return false;
  if (t.major !== BUN_FLOOR.major) return t.major > BUN_FLOOR.major;
  if (t.minor !== BUN_FLOOR.minor) return t.minor > BUN_FLOOR.minor;
  return t.patch >= BUN_FLOOR.patch;
}

/**
 * @param {{ bun?: string, node?: string, sqlite?: string | null }} [opts]
 */
export function describeRuntime(opts = {}) {
  const bun = opts.bun !== undefined ? opts.bun : process.versions.bun;
  if (bun) {
    const ver = opts.sqlite !== undefined ? opts.sqlite : null;
    const bunOk = bunPasses(bun);
    const sqlOk = Boolean(ver) && libClearsWalResetWindow(ver);
    const allowed = bunOk && sqlOk;
    let detail;
    if (!bunOk) {
      detail = `Bun ${bun} is below 1.4.0.`;
    } else if (!ver) {
      detail = `Bun ${bun} has no usable node:sqlite.`;
    } else if (!sqlOk) {
      detail = `Bun ${bun} embeds SQLite ${ver}, which is not WAL-reset safe.`;
    }
    return {
      kind: "bun",
      version: String(bun),
      raw: String(bun),
      allowed: Boolean(allowed),
      sqlite: ver || null,
      detail,
    };
  }
  return opts.node !== undefined
    ? { kind: "node", ...describeHost(opts.node) }
    : { kind: "node", ...describeHost() };
}

export function runtimeCompatBanner(info) {
  if (info?.kind === "bun") {
    return [
      `xclaw refused to start on Bun v${info.version || info.raw}`,
      info.detail,
      "Bun 1.4.0+ with node:sqlite and a WAL-reset-safe SQLite is required.",
      "Node remains the ship default.",
    ].join("\n");
  }
  return hostCompatBanner(info);
}
