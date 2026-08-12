/**
 * XClaw author signature on git commits (Claude Code / Happy style).
 *
 * ALWAYS appended when XClaw creates or intercepts a commit:
 *   Generated with [XClaw](https://x.ai/)
 *   Co-Authored-By: XClaw <noreply@xclaw.local>
 *
 * Also installs a prepare-commit-msg hook so agent `git commit` picks them up.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_GENERATED_WITH =
  "Generated with [XClaw](https://x.ai/)";

export const DEFAULT_CO_AUTHORED_BY =
  "Co-Authored-By: XClaw <noreply@xclaw.local>";

/**
 * Build trailer block from config.
 * @param {object} [cfg]
 */
export function buildXclawTrailers(cfg = {}) {
  const git = cfg.git || {};
  // allow disable only with explicit false
  if (git.alwaysTrailers === false && git.commitTrailers === false) {
    return "";
  }
  const generated =
    git.commitGeneratedWith != null
      ? String(git.commitGeneratedWith)
      : DEFAULT_GENERATED_WITH;
  const coAuthored =
    git.commitCoAuthoredBy != null
      ? String(git.commitCoAuthoredBy)
      : DEFAULT_CO_AUTHORED_BY;

  const lines = [];
  if (generated.trim()) lines.push(generated.trim());
  if (coAuthored.trim()) lines.push(coAuthored.trim());
  for (const extra of git.commitExtraTrailers || []) {
    if (extra && String(extra).trim()) lines.push(String(extra).trim());
  }
  return lines.join("\n");
}

/**
 * Append trailers if not already present in message.
 */
export function appendCommitTrailers(message, trailers) {
  const body = String(message || "").trimEnd();
  const t = String(trailers || "").trim();
  if (!t) return body;
  // Idempotent: already has Co-Authored-By: XClaw
  if (/Co-Authored-By:\s*XClaw\b/i.test(body)) {
    return body;
  }
  if (!body) return t;
  return `${body}\n\n${t}`;
}

/**
 * Ensure message carries XClaw signature (mandatory path).
 */
export function ensureXclawCommitMessage(message, cfg = {}) {
  const trailers = buildXclawTrailers(cfg);
  return appendCommitTrailers(message, trailers);
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
 * Install prepare-commit-msg hook so ANY git commit in this repo
 * gets XClaw trailers (agent bash, CLI, IDE).
 */
export async function installXclawCommitHook(repoDir, cfg = {}) {
  const gitDir = await run("git", ["rev-parse", "--git-dir"], repoDir);
  if (gitDir.code !== 0) {
    return { ok: false, error: "not a git repository" };
  }
  const gd = path.resolve(repoDir, gitDir.stdout.trim());
  const hookPath = path.join(gd, "hooks", "prepare-commit-msg");
  const trailers = buildXclawTrailers(cfg).replace(/"/g, '\\"');
  const script = `#!/bin/sh
# XClaw — always add author signature trailers
MSG_FILE="$1"
SOURCE="$2"
# Skip merge/squash auto messages if already complete; still append if missing
if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
  exit 0
fi
if grep -q "Co-Authored-By: XClaw" "$MSG_FILE" 2>/dev/null; then
  exit 0
fi
# Do not inject into pure merge commits unless empty trailers area
if [ "$SOURCE" = "merge" ] && grep -q "Merge " "$MSG_FILE" 2>/dev/null; then
  printf '\\n\\n%s\\n' "${trailers}" >> "$MSG_FILE"
  exit 0
fi
printf '\\n\\n%s\\n' "${trailers}" >> "$MSG_FILE"
exit 0
`;
  try {
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, script, { mode: 0o755 });
    return { ok: true, hookPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Create a git commit with mandatory XClaw trailers.
 */
export async function commitWithXclawTrailers(repoDir, opts = {}) {
  const cfg = opts.cfg || {};
  // Ensure hook so even subsequent commits get signature
  if (opts.installHook !== false) {
    await installXclawCommitHook(repoDir, cfg).catch(() => {});
  }

  const subject =
    opts.subject ||
    cfg.swarm?.commitSubject ||
    cfg.git?.commitSubject ||
    "chore: apply XClaw changes";
  const body = opts.body || "";
  const message = ensureXclawCommitMessage(
    body ? `${subject}\n\n${body}` : subject,
    cfg
  );

  if (opts.all !== false) {
    const add = await run("git", ["add", "-A"], repoDir);
    if (add.code !== 0) {
      return {
        ok: false,
        code: "GIT_ADD_FAILED",
        error: add.stderr || "git add failed",
      };
    }
  }

  const st = await run("git", ["status", "--porcelain"], repoDir);
  if (!st.stdout.trim() && !opts.allowEmpty) {
    return {
      ok: true,
      skipped: true,
      reason: "clean working tree",
      message,
    };
  }

  const args = ["commit", "-m", message];
  if (opts.allowEmpty) args.push("--allow-empty");
  const author = cfg.git?.commitAuthor || cfg.swarm?.commitAuthor;
  if (author) args.push("--author", author);

  const c = await run("git", args, repoDir);
  if (c.code !== 0) {
    return {
      ok: false,
      code: "GIT_COMMIT_FAILED",
      error: c.stderr || c.stdout || "git commit failed",
      message,
    };
  }

  const sha = await run("git", ["rev-parse", "HEAD"], repoDir);
  return {
    ok: true,
    sha: (sha.stdout || "").trim() || null,
    message,
    trailers: buildXclawTrailers(cfg),
  };
}
