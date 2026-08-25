/**
 * Gateway artifacts-browser routes (extracted from gateway/index.mjs, W2).
 *
 * Paths:
 *   GET /artifacts/list — workspace artifact listing
 *   GET /artifacts/file — inline artifact bytes (strict workspace
 *       containment + extension allowlist via gateway/artifact-file.mjs)
 *   GET /artifacts[/]   — the artifacts UI page
 */
import fs from "node:fs/promises";
import path from "node:path";
import { listArtifacts } from "../../artifacts/browser.mjs";
import { matchUiRoute } from "../ui-routes.mjs";

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleArtifactsRoute({ p, method, res, url, cfg, json, root }) {
  if (p === "/artifacts/list" && method === "GET") {
    const workspace = cfg.agent?.workingDir || cfg.workspace || process.cwd();
    const listing = await listArtifacts(workspace);
    json(res, 200, listing);
    return true;
  }
  if (p === "/artifacts/file" && method === "GET") {
    const { resolveArtifactFile } = await import("../artifact-file.mjs");
    const roots = [
      cfg.paths?.workspaces,
      cfg.agent?.workingDir || cfg.workspace || process.cwd(),
    ].filter(Boolean);
    const rf = await resolveArtifactFile(roots, url.searchParams.get("path"));
    if (!rf.ok) {
      const code = rf.code === "not_found" ? 404 : rf.code === "type_not_allowed" ? 415 : 400;
      json(res, code, { error: rf.error, code: rf.code });
      return true;
    }
    const data = await fs.readFile(rf.abs);
    res.writeHead(200, {
      "Content-Type": rf.mime,
      "Content-Length": data.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
    return true;
  }
  // Same route table gateway/auth.mjs consults, so the page and the two API
  // routes above can never fall on the same side of the publicUi lockdown.
  if (matchUiRoute(p)?.app === "artifacts") {
    const htmlPath = path.join(root, "ui", "artifacts", "index.html");
    const html = await fs.readFile(htmlPath, "utf8").catch(() => "<h1>artifacts UI missing</h1>");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  }
  return false;
}

export default { tryHandleArtifactsRoute };
