/**
 * H1 — Verify step: objective checks on workspace after agent run.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * @param {string} workspace
 * @param {object[]} checks
 * @returns {Promise<{ ok: boolean, results: object[] }>}
 */
export async function runVerifyChecks(workspace, checks = []) {
  const results = [];
  for (const check of checks) {
    const r = await runOne(workspace, check);
    results.push(r);
  }
  return { ok: results.every((r) => r.pass), results };
}

function resolveCheckPath(workspace, filePath) {
  const raw = String(filePath || "");
  if (!raw) return path.resolve(workspace);
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
}

async function runOne(workspace, check) {
  const type = check.type;
  try {
    switch (type) {
      case "file_exists": {
        const p = resolveCheckPath(workspace, check.path);
        await fs.access(p);
        return { type, path: check.path, pass: true };
      }
      case "file_contains": {
        const p = resolveCheckPath(workspace, check.path);
        const text = await fs.readFile(p, "utf8");
        let pass = false;
        if (check.regex) {
          const flags = check.flags || (check.caseInsensitive ? "i" : "");
          pass = new RegExp(check.regex, flags).test(text);
        } else if (check.caseInsensitive) {
          pass = text.toLowerCase().includes(String(check.text || "").toLowerCase());
        } else {
          pass = text.includes(check.text || "");
        }
        return { type, path: check.path, pass, detail: pass ? "match" : "no match" };
      }
      case "file_equals": {
        const p = resolveCheckPath(workspace, check.path);
        const text = await fs.readFile(p, "utf8");
        // `value` is an accepted alias for `content` (objectives share this
        // parser via the deterministic verify gate). A check with neither
        // fails loudly rather than silently comparing against "" — that
        // silent empty-string compare mis-verified a real objective.
        const expected = check.content ?? check.value;
        if (expected === undefined) {
          return {
            type,
            path: check.path,
            pass: false,
            detail: "file_equals missing expected 'content' (or 'value')",
          };
        }
        const pass = text === expected;
        return { type, path: check.path, pass, detail: pass ? undefined : "content mismatch" };
      }
      case "file_not_exists": {
        const p = resolveCheckPath(workspace, check.path);
        try {
          await fs.access(p);
          return { type, path: check.path, pass: false, detail: "exists" };
        } catch {
          return { type, path: check.path, pass: true };
        }
      }
      case "command": {
        const out = await runCmd(check.cmd, workspace, check.timeoutMs || 15000);
        const code = out.code;
        let pass = code === (check.exitCode ?? 0);
        if (pass && check.stdoutContains) {
          pass = String(out.stdout || "").includes(check.stdoutContains);
        }
        if (pass && check.stdoutRegex) {
          pass = new RegExp(check.stdoutRegex, check.flags || "").test(String(out.stdout || ""));
        }
        return {
          type,
          cmd: check.cmd,
          pass,
          exitCode: code,
          detail: pass ? undefined : `stdout miss (code=${code})`,
        };
      }
      case "text_contains": {
        const pass = String(check.haystack || "").includes(check.text || "");
        return { type, pass };
      }
      default:
        return { type, pass: false, detail: `unknown check type: ${type}` };
    }
  } catch (err) {
    return { type, pass: false, detail: err.message };
  }
}

function runCmd(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", cmd], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve({ code: 1, stdout, stderr });
    });
  });
}
