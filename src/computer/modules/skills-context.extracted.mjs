/** EXTRACTED skills/context region L380000-382467 */
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d3, b) {
  return b + 30 + b2(d3, b + 26) + b2(d3, b + 28);
};
var zh = function(d3, b, z) {
  var fnl = b2(d3, b + 28), fn = strFromU8(d3.subarray(b + 46, b + 46 + fnl), !(b2(d3, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d3, b + 20);
  var _a2 = z && bs == 4294967295 ? z64e(d3, es) : [bs, b4(d3, b + 24), b4(d3, b + 42)], sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d3, b + 10), sc, su, fn, es + b2(d3, b + 30) + b2(d3, b + 32), off];
};
var z64e = function(d3, b) {
  for (; b2(d3, b) != 1; b += 4 + b2(d3, b + 2))
    ;
  return [b8(d3, b + 12), b8(d3, b + 4), b8(d3, b + 20)];
};
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = o == 4294967295 || c == 65535;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i = 0; i < c; ++i) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// build/skills/skillService.js
import { mkdir as mkdir2, readdir, readFile as readFile2, rm, stat as stat2, writeFile as writeFile2 } from "fs/promises";
import { homedir } from "os";
import { basename, dirname as dirname2, join as join2 } from "path";

// build/skills/frontmatter.js
function parseSkillFile(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match2 = normalized.match(/^---\s*\n([\s\S]*?\n)?---\s*\n?([\s\S]*)$/);
  if (!match2) {
    return { attributes: {}, body: normalized.trim() };
  }
  const [, frontmatterBlock = "", body] = match2;
  const attributes = {};
  for (const line of frontmatterBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
      continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1)
      continue;
    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) {
      attributes[key] = value;
    }
  }
  return { attributes, body: body.trim() };
}

// build/skills/skillService.js
function getGlobalSkillsDir() {
  return join2(homedir(), ".xclaw", "skills");
}
function getProjectSkillsDir(workingDir) {
  return join2(workingDir, ".xclaw", "skills");
}
function resolveSkillsDir(scope, workingDir) {
  if (scope === "project") {
    if (!workingDir) {
      throw new Error("workingDir is required for project-scoped skill operations");
    }
    return getProjectSkillsDir(workingDir);
  }
  return getGlobalSkillsDir();
}
async function scanSkillsDir(dir, scope) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (entry.name.startsWith("."))
      continue;
    const skillDir = join2(dir, entry.name);
    const skillFile = join2(skillDir, "SKILL.md");
    try {
      const stats = await stat2(skillFile);
      if (!stats.isFile())
        continue;
    } catch {
      continue;
    }
    try {
      const raw = await readFile2(skillFile, "utf-8");
      const { attributes } = parseSkillFile(raw);
      const name = attributes.name || entry.name;
      const description = attributes.description || "";
      results.push({ name, description, path: skillDir, scope });
    } catch (err2) {
      log_default.warn(`Failed to parse installed skill at ${skillDir}: ${err2}`);
    }
  }
  return results;
}
async function listInstalledSkills(workingDir) {
  const globalSkills = await scanSkillsDir(getGlobalSkillsDir(), "global");
  if (!workingDir) {
    return globalSkills;
  }
  const projectSkills = await scanSkillsDir(getProjectSkillsDir(workingDir), "project");
  return [...projectSkills, ...globalSkills];
}
async function fetchRemoteSkillDescription(repo, path12, skillName, ref) {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${ref}/${path12}/${skillName}/SKILL.md`;
    const res = await fetch(rawUrl, {
      headers: { "User-Agent": "xclaw-computer-skill-service" }
    });
    if (!res.ok)
      return "";
    const text = await res.text();
    const { attributes } = parseSkillFile(text);
    return attributes.description || "";
  } catch {
    return "";
  }
}
async function listRemoteSkills(repo, path12, ref, workingDir) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const headers = {
    "User-Agent": "xclaw-computer-skill-service"
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path12}?ref=${ref}`;
  const res = await fetch(apiUrl, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch skills from GitHub: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response format from GitHub API");
  }
  const dirs = data.filter((item) => item.type === "dir");
  const installedSkills = await listInstalledSkills(workingDir);
  const globalNames = new Set(installedSkills.filter((s) => s.scope === "global").map((s) => s.name));
  const projectNames = new Set(installedSkills.filter((s) => s.scope === "project").map((s) => s.name));
  const descriptions = await Promise.all(dirs.map((item) => fetchRemoteSkillDescription(repo, path12, item.name, ref)));
  return dirs.map((item, i) => ({
    name: item.name,
    description: descriptions[i],
    installedGlobal: globalNames.has(item.name),
    installedProject: projectNames.has(item.name)
  }));
}
function parseGitHubUrl(url) {
  const stripped = url.replace(/^https:\/\/github\.com\//, "");
  const parts = stripped.split("/");
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
  const repo = `${parts[0]}/${parts[1]}`;
  let ref = "main";
  let path12 = "";
  if (parts.length >= 5 && parts[2] === "tree") {
    ref = parts[3];
    path12 = parts.slice(4).join("/");
  } else if (parts.length >= 3) {
    path12 = parts.slice(2).join("/");
  }
  return { repo, ref, path: path12 };
}
async function downloadAndExtractSkill(repo, ref, skillPath, destDir) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const zipUrl = `https://codeload.github.com/${repo}/zip/${ref}`;
  const headers = {
    "User-Agent": "xclaw-computer-skill-installer"
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  log_default.info(`Downloading ${repo}@${ref}...`);
  const res = await fetch(zipUrl, { headers });
  if (!res.ok) {
    throw new Error(`Failed to download ${repo}@${ref}: ${res.status} ${res.statusText}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const entries = unzipSync(new Uint8Array(arrayBuf));
  const topLevelDirs = /* @__PURE__ */ new Set();
  for (const entryName of Object.keys(entries)) {
    const first = entryName.split("/")[0];
    if (first)
      topLevelDirs.add(first);
  }
  const roots = [...topLevelDirs].filter((d3) => d3 !== "__MACOSX");
  if (roots.length === 0) {
    throw new Error("Empty zip archive");
  }
  const archiveRoot = roots[0];
  const prefix = `${archiveRoot}/${skillPath}/`;
  const skillMdKey = `${prefix}SKILL.md`;
  if (!(skillMdKey in entries)) {
    const hasDir = Object.keys(entries).some((k) => k.startsWith(prefix));
    if (!hasDir) {
      throw new Error(`Skill path not found in archive: ${skillPath}`);
    }
    throw new Error(`No SKILL.md found in ${skillPath}`);
  }
  await mkdir2(destDir, { recursive: true });
  for (const [entryName, data] of Object.entries(entries)) {
    if (!entryName.startsWith(prefix))
      continue;
    const relativePath = entryName.slice(prefix.length);
    if (!relativePath)
      continue;
    const fullPath = join2(destDir, ...relativePath.split("/"));
    if (entryName.endsWith("/")) {
      await mkdir2(fullPath, { recursive: true });
    } else {
      await mkdir2(dirname2(fullPath), { recursive: true });
      await writeFile2(fullPath, data);
    }
  }
}
async function installSkill(options) {
  const scope = options.scope || "global";
  const dest = resolveSkillsDir(scope, options.workingDir);
  let repo = options.repo || "";
  let skillPath = options.path || "";
  let ref = options.ref || "main";
  if (options.url) {
    const parsed = parseGitHubUrl(options.url);
    repo = parsed.repo;
    ref = parsed.ref;
    skillPath = parsed.path;
  }
  if (!repo)
    throw new Error("Missing repo or url");
  if (!skillPath)
    throw new Error("Missing skill path");
  const name = options.name || basename(skillPath);
  if (!name)
    throw new Error("Could not determine skill name");
  const destDir = join2(dest, name);
  try {
    const s = await stat2(destDir);
    if (s.isDirectory()) {
      throw new Error(`Destination already exists: ${destDir}`);
    }
  } catch (err2) {
    if (!(err2 instanceof Error && "code" in err2 && err2.code === "ENOENT")) {
      throw err2;
    }
  }
  log_default.info({ repo, skillPath, ref, name, scope }, "Installing skill");
  try {
    await downloadAndExtractSkill(repo, ref, skillPath, destDir);
  } catch (err2) {
    await rm(destDir, { recursive: true, force: true }).catch(() => {
    });
    const message = err2 instanceof Error ? err2.message : String(err2);
    log_default.error(`Skill install failed: ${message}`);
    throw new Error(`Failed to install skill: ${message}`);
  }
  log_default.info(`Installed skill (${scope}): ${name} to ${destDir}`);
  return { success: true, name, path: destDir, scope };
}
async function uninstallSkill(name, scope = "global", workingDir) {
  const dir = resolveSkillsDir(scope, workingDir);
  const skillDir = join2(dir, name);
  if (!skillDir.startsWith(dir)) {
    throw new Error("Invalid skill name");
  }
  try {
    const stats = await stat2(skillDir);
    if (!stats.isDirectory()) {
      throw new Error(`${name} is not a skill directory`);
    }
  } catch (err2) {
    if (err2 instanceof Error && "code" in err2 && err2.code === "ENOENT") {
      throw new Error(`Skill "${name}" is not installed`);
    }
    throw err2;
  }
  await rm(skillDir, { recursive: true, force: true });
  log_default.info(`Uninstalled skill (${scope}): ${name}`);
}

// build/utils/execFileNoThrow.js
import { execFile } from "child_process";
var MS_IN_SECOND = 1e3;
var SECONDS_IN_MINUTE = 60;
function execFileNoThrow(file, args, cwd, abortSignal, timeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND, preserveOutputOnError = true) {
  return new Promise((resolve6) => {
    try {
      execFile(file, args, {
        maxBuffer: 1e6,
        signal: abortSignal,
        timeout,
        cwd: cwd || process.cwd()
      }, (error, stdout, stderr) => {
        if (error) {
          if (preserveOutputOnError) {
            const errorCode = typeof error.code === "number" ? error.code : 1;
            resolve6({
              stdout: stdout || "",
              stderr: stderr || "",
              code: errorCode,
              error
            });
          } else {
            resolve6({ stdout: "", stderr: "", code: 1, error });
          }
        } else {
          resolve6({ stdout, stderr, code: 0 });
        }
      });
    } catch (error) {
      log.error(error);
      resolve6({ stdout: "", stderr: "", code: 1, error });
    }
  });
}

// build/utils/git.js
var getIsGit = memoize_default(async (cwd) => {
  const { code } = await execFileNoThrow("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  return code === 0;
});

// build/utils/list.js
import fs from "fs/promises";
import { homedir as homedir2 } from "os";
import { dirname as dirname3, isAbsolute, join as join3, resolve as resolve2, sep } from "path";

// build/utils/gitignoreMatcher.js
var GitignoreMatcher = class {
  rules = [];
  /** Append patterns from a `.gitignore` blob (lines split internally). */
  add(content) {
    for (const raw of content.split("\n")) {
      const rule = parseLine(raw);
      if (rule)
        this.rules.push(rule);
    }
  }
  /**
   * Apply rules in order; later matches override earlier (incl. negations).
   * Returns true (ignored), false (unignored by `!`), or undefined (no rule
   * matched — caller keeps prior state). `path` must be POSIX.
   */
  match(path12, isDir) {
    let result;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir)
        continue;
      if (rule.regex.test(path12)) {
        result = !rule.negate;
      }
    }
    return result;
  }
};
function parseLine(line) {
  let p = line.replace(/\s+$/, "");
  if (!p || p.startsWith("#"))
    return null;
  let negate = false;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  }
  let dirOnly = false;
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  const rooted = p.startsWith("/") || p.includes("/");
  if (p.startsWith("/"))
    p = p.slice(1);
  return { regex: globToRegex(p, rooted), negate, dirOnly };
}
var REGEX_SPECIALS = /* @__PURE__ */ new Set([".", "+", "(", ")", "|", "^", "$", "{", "}", "\\"]);
function globToRegex(pattern, rooted) {
  let regex = rooted ? "^" : "(?:^|/)";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          regex += "(?:.*/)?";
          i += 3;
        } else {
          regex += ".*";
          i += 2;
        }
      } else {
        regex += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      regex += "[^/]";
      i += 1;
    } else if (c === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        regex += "\\[";
        i += 1;
      } else {
        regex += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else if (REGEX_SPECIALS.has(c)) {
      regex += "\\" + c;
      i += 1;
    } else {
      regex += c;
      i += 1;
    }
  }
  regex += "(?:$|/)";
  return new RegExp(regex);
}

// build/utils/list.js
var GITIGNORE_MARKER = " (.gitignore)";
async function ls(path12, abortController, cwd) {
  const fullPath = isAbsolute(path12) ? path12 : resolve2(cwd, path12);
  let entries = [];
  let ignore = null;
  try {
    [entries, ignore] = await Promise.all([
      fs.readdir(fullPath, { withFileTypes: true }),
      loadRootIgnore(fullPath)
    ]);
  } catch (e) {
    log_default.error(e);
    return "";
  }
  if (abortController.signal.aborted)
    return "";
  const visible = entries.filter((e) => {
    const name = e.name.toString();
    if (skip(name))
      return false;
    if (e.isDirectory())
      return true;
    return ignore?.match(name, false) !== true;
  }).sort((a, b) => a.name.toString().localeCompare(b.name.toString()));
  const lines = [`${fullPath}${sep}`];
  for (const entry of visible) {
    const name = entry.name.toString();
    const isDir = entry.isDirectory();
    const marker = isDir && ignore?.match(name, true) === true ? GITIGNORE_MARKER : "";
    lines.push(` ${name}${isDir ? sep : ""}${marker}`);
  }
  return lines.join("\n");
}
function skip(name) {
  return name.startsWith(".") || name === "__pycache__";
}
async function loadRootIgnore(cwd) {
  const ancestors = [];
  let cursor = cwd;
  while (ancestors.length < 64) {
    ancestors.push(cursor);
    const parent = dirname3(cursor);
    if (!parent || parent === cursor)
      break;
    cursor = parent;
  }
  const probes = await Promise.all(ancestors.map(async (dir) => {
    const [gitStat, gitignore] = await Promise.all([
      fs.stat(join3(dir, ".git")).catch(() => null),
      fs.readFile(join3(dir, ".gitignore"), "utf-8").catch(() => "")
    ]);
    return { dir, gitStat, gitignore };
  }));
  const repoIdx = probes.findIndex((p) => p.gitStat !== null);
  if (repoIdx === -1)
    return null;
  let content = "";
  for (let i = 0; i <= repoIdx; i++) {
    const g = probes[i].gitignore;
    if (g)
      content += "\n" + g;
  }
  const repoRoot = probes[repoIdx].dir;
  const gitMeta = probes[repoIdx].gitStat;
  const [infoExclude, globalIgnore] = await Promise.all([
    readInfoExclude(repoRoot, gitMeta.isDirectory()),
    readGlobalIgnore()
  ]);
  if (infoExclude)
    content += "\n" + infoExclude;
  if (globalIgnore)
    content += "\n" + globalIgnore;
  const trimmed = content.trim();
  if (!trimmed)
    return null;
  const matcher = new GitignoreMatcher();
  matcher.add(trimmed);
  return matcher;
}
async function readInfoExclude(repoRoot, gitIsDir) {
  if (gitIsDir) {
    return fs.readFile(join3(repoRoot, ".git", "info", "exclude"), "utf-8").catch(() => "");
  }
  const gitlink = await fs.readFile(join3(repoRoot, ".git"), "utf-8").catch(() => "");
  const match2 = gitlink.match(/^gitdir:\s*(.+)$/m);
  if (!match2)
    return "";
  const adminDir = match2[1].trim();
  return fs.readFile(join3(adminDir, "info", "exclude"), "utf-8").catch(() => "");
}
async function readGlobalIgnore() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const path12 = xdg ? join3(xdg, "git", "ignore") : join3(homedir2(), ".config", "git", "ignore");
  return fs.readFile(path12, "utf-8").catch(() => "");
}

// build/utils/ripgrep.js
var import_debug = __toESM(require_src(), 1);
import { execFileSync } from "child_process";
import { accessSync, constants as constants2 } from "fs";
var import_spawn_rx = __toESM(require_src2(), 1);
import path from "path";
import { fileURLToPath } from "url";
var d = (0, import_debug.default)("xclaw:ripgrep");
var ripgrepPath = memoize_default(() => {
  const useBuiltinRipgrep = !!process.env.USE_BUILTIN_RIPGREP;
  if (useBuiltinRipgrep) {
    d("Using builtin ripgrep because USE_BUILTIN_RIPGREP is set");
  }
  const isWin32 = process.platform === "win32";
  const rgBinName = isWin32 ? "rg.exe" : "rg";
  let cmd = (0, import_spawn_rx.findActualExecutable)("rg", []).cmd;
  d(`ripgrep initially resolved as: ${cmd}`);
  if ((cmd === "rg" || cmd === "rg.exe") && !process.env.VITEST) {
    const paths = process.env.PATH?.split(path.delimiter) || [];
    for (const dir of paths) {
      const full = path.join(dir, rgBinName);
      try {
        accessSync(full, constants2.X_OK);
        execFileSync(full, ["--version"], {
          timeout: 1e3,
          stdio: "ignore",
          cwd: "."
        });
        cmd = full;
        d("Resolved system rg at %s", cmd);
        break;
      } catch {
      }
    }
  }
  if (cmd !== "rg" && cmd !== "rg.exe" && !useBuiltinRipgrep) {
    return cmd;
  } else {
    const baseDir = process.env.XCLAW_COMPUTER_BASE_DIR || (process.versions?.bun ? path.resolve(path.dirname(process.execPath), "..") : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
    const rgRoot = path.join(baseDir, "vendor", "ripgrep");
    if (isWin32) {
      return path.join(rgRoot, "x64-win32", "rg.exe");
    }
    const ret = path.join(rgRoot, `${process.arch}-${process.platform}`, "rg");
    d("internal ripgrep resolved as: %s", ret);
    return ret;
  }
});
async function ripGrep(args, target, abortSignal, timeout = 1e4) {
  await codesignRipgrepIfNecessary();
  const rg = ripgrepPath();
  const result = await execFileNoThrow(rg, args, target, abortSignal, timeout, true);
  if (result.code !== 0) {
    if (result.code !== 1) {
      log.error(`ripgrep failed with code ${result.code}: ${result.stderr}`);
    }
    if (result.error?.killed) {
      return { timedOut: true, lines: [] };
    }
    return { timedOut: false, lines: [] };
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  return { timedOut: false, lines };
}
async function listAllContentFiles(path12, abortSignal, limit) {
  try {
    d("listAllContentFiles called: %s", path12);
    return (await ripGrep(["-l", ".", "."], path12, abortSignal)).lines.slice(0, limit);
  } catch (e) {
    d("listAllContentFiles failed: %o", e);
    log.error(e);
    return [];
  }
}
var signCheck = { alreadyDone: false };
async function codesignRipgrepIfNecessary() {
  if (process.platform !== "darwin" || signCheck.alreadyDone) {
    return;
  }
  signCheck.alreadyDone = true;
  const rgPath = ripgrepPath();
  if (!rgPath.includes("vendor/ripgrep")) {
    d("Skipping codesign for non-vendored rg");
    return;
  }
  d("checking if ripgrep is already signed");
  const lines = (await execFileNoThrow("codesign", ["-vv", "-d", rgPath], void 0, void 0, void 0, false)).stdout.split("\n");
  const needsSigned = lines.find((line) => line.includes("linker-signed"));
  if (!needsSigned) {
    d("seems to be already signed");
    return;
  }
  try {
    d("signing ripgrep");
    const signResult = await execFileNoThrow("codesign", [
      "--sign",
      "-",
      "--force",
      "--preserve-metadata=entitlements,requirements,flags,runtime",
      rgPath
    ]);
    if (signResult.code !== 0) {
      d("failed to sign ripgrep: %o", signResult);
      log.error(`Failed to sign ripgrep: ${signResult.stdout} ${signResult.stderr}`);
    }
    d("removing quarantine");
    const quarantineResult = await execFileNoThrow("xattr", [
      "-d",
      "com.apple.quarantine",
      rgPath
    ]);
    if (quarantineResult.code !== 0) {
      d("failed to remove quarantine: %o", quarantineResult);
      log.error(`Failed to remove quarantine: ${quarantineResult.stdout} ${quarantineResult.stderr}`);
    }
  } catch (e) {
    d("failed during sign: %o", e);
    log.error(e);
  }
}

// build/utils/style.js
import fs2 from "fs/promises";
import { join as join4, parse, dirname as dirname4 } from "path";
async function getXClawMemory(session) {
  const styles = [];
  let currentDir = session.originalWorkingDir;
  while (currentDir !== parse(currentDir).root) {
    const fileNames = ["XCLAW.md", "AGENTS.md"];
    for (const fileName of fileNames) {
      const stylePath = join4(currentDir, fileName);
      try {
        await fs2.access(stylePath);
        const content = await fs2.readFile(stylePath, "utf-8");
        styles.push(`Contents of ${stylePath}:

${content}`);
      } catch {
      }
    }
    currentDir = dirname4(currentDir);
  }
  if (styles.length === 0)
    return "";
  return `${styles.reverse().join("\n\n")}`;
}

// build/utils/user.js
var getGitEmail = memoize_default(async (cwd) => {
  const result = await execFileNoThrow("git", ["config", "user.email"], cwd);
  if (result.code !== 0) {
    log.error(`Failed to get git email: ${result.stdout} ${result.stderr}`);
    return void 0;
  }
  return result.stdout.trim() || void 0;
});
var getUser = memoize_default(() => process.env.CONTAINER_USER || process.env.USER || process.env.USERNAME || "unknown");

// build/context.js
async function getEnvInfo(session) {
  const execPromise = util2.promisify(exec);
  const cwd = session.originalWorkingDir;
  let isGitRepo2 = false;
  try {
    const { stdout } = await execPromise("git rev-parse --is-inside-work-tree", { cwd });
    isGitRepo2 = stdout.trimEnd() === "true";
  } catch {
    isGitRepo2 = false;
  }
  const platform = process.platform;
  const shell = platform === "win32" ? "PowerShell" : session.shellBin;
  const lines = [
    `## Environment Info`,
    `Working directory: ${cwd}`,
    `Is directory a git repo: ${isGitRepo2 ? "Yes" : "No"}`,
    `Platform: ${platform}`,
    `Shell: ${shell}`,
    `Internet access: ${session.hasInternetAccess ? "Enabled" : "Disabled"}`
  ];
  if (!session.hasInternetAccess) {
    lines.push(`Package managers: Available (pip, npm, go, cargo, and others work without internet)`);
  }
  return lines.join("\n");
}
async function getXClawFiles(session) {
  const cwd = session.originalWorkingDir;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 3e3);
  try {
    let lines;
    if (await getIsGit(cwd)) {
      const { code, stdout } = await execFileNoThrow("git", [
        "-C",
        cwd,
        "ls-files",
        "**/XCLAW.md",
        "**/AGENTS.md",
        "XCLAW.md",
        "AGENTS.md"
      ], cwd, abortController.signal, 3e3, false);
      if (code !== 0)
        return null;
      lines = stdout.split("\n").filter((l) => l.length > 0);
    } else {
      const files = await ripGrep(["--files", "--glob", "**/**/XCLAW.md", "--glob", "**/**/AGENTS.md", "."], cwd, abortController.signal);
      lines = files.lines;
    }
    if (lines.length === 0)
      return null;
    return `NOTE: Additional XCLAW.md or AGENTS.md files were found. When working in these directories, make sure to read and follow the instructions in the corresponding file:
${lines.map((file) => path2.join(cwd, file)).map((line) => `- ${line}`).join("\n")}`;
  } catch (error) {
    log_default.error(error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
var getReadme = async (session) => {
  try {
    const readmePath = join5(session.originalWorkingDir, "README.md");
    try {
      await access(readmePath, constants3.F_OK);
    } catch {
      return null;
    }
    const content = await readFile3(readmePath, "utf-8");
    return content;
  } catch (e) {
    log_default.error(e);
    return null;
  }
};
var getGitStatus = async (session) => {
  if (process.env.NODE_ENV === "test") {
    return null;
  }
  if (!await getIsGit(session.originalWorkingDir)) {
    return null;
  }
  try {
    const gitEmail = await getGitEmail(session.originalWorkingDir);
    const [branch, mainBranch, status, log2, authorLog] = await Promise.all([
      execFileNoThrow("git", ["branch", "--show-current"], session.originalWorkingDir, void 0, void 0, false).then(({ stdout }) => stdout.trimEnd()),
      execFileNoThrow("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], session.originalWorkingDir, void 0, void 0, false).then(({ stdout }) => stdout.replace("origin/", "").trim()),
      execFileNoThrow(
        "git",
        // --ignore-submodules=all saves ~500 ms on xAI monorepo;
        // --no-ahead-behind skips computation we don't render.
        ["status", "--short", "--ignore-submodules=all", "--no-ahead-behind"],
        session.originalWorkingDir,
        void 0,
        void 0,
        false
      ).then(({ stdout }) => stdout.trimEnd()),
      execFileNoThrow("git", ["log", "--oneline", "-n", "5"], session.originalWorkingDir, void 0, void 0, false).then(({ stdout }) => stdout.trimEnd()),
      gitEmail ? execFileNoThrow("git", [
        "log",
        "--oneline",
        "-n",
        "5",
        // `--fixed-strings`: match the email literally, not as a regex.
        "--fixed-strings",
        "--author",
        gitEmail
      ], session.originalWorkingDir, void 0, void 0, false).then(({ stdout }) => stdout.trimEnd()) : Promise.resolve("")
    ]);
    const statusLines = status.split("\n").length;
    const truncatedStatus = statusLines > 200 ? status.split("\n").slice(0, 200).join("\n") + `
... (truncated because there are more than 200 lines. If you need more information, run "git status" using the bash tool)` : status;
    const summary = `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
Current branch: ${branch}

Main branch (you will usually use this for PRs): ${mainBranch}

Status:
${truncatedStatus || "(clean)"}

Recent commits:
${log2 || "(no recent commits)"}`;
    return gitEmail ? `${summary}

Your recent commits:
${authorLog || "(no recent commits)"}` : summary;
  } catch (error) {
    log_default.error(error);
    return null;
  }
};
function formatSkillLine(s) {
  return `- ${s.name}: ${s.description}${s.path ? ` (${join5(s.path, "SKILL.md")})` : ""}`;
}
function compareSkillName(a, b) {
  return a.name.localeCompare(b.name);
}
async function getAvailableSkills(session) {
  try {
    const skills = await session.skillManager.list();
    if (skills.length === 0)
      return null;
    const seen = /* @__PURE__ */ new Set();
    const deduped = [];
    const duplicatedNames = /* @__PURE__ */ new Set();
    for (const s of skills) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        deduped.push(s);
      } else {
        duplicatedNames.add(s.name);
      }
    }
    const bundled = [];
    const custom2 = [];
    for (const s of deduped) {
      if (BUNDLED_SKILL_NAMES_SET.has(s.name) && !duplicatedNames.has(s.name)) {
        bundled.push(s);
      } else {
        custom2.push(s);
      }
    }
    bundled.sort(compareSkillName);
    custom2.sort(compareSkillName);
    const globalBase = getGlobalSkillsDir();
    const projectBase = getProjectSkillsDir(session.rootWorkingDir);
    const parts = [];
    if (bundled.length > 0) {
      parts.push(`Bundled skills (located in ${globalBase}/)
${bundled.map(formatSkillLine).join("\n")}`);
    }
    if (custom2.length > 0) {
      parts.push(`User custom skills (located in ${projectBase}/)
${custom2.map(formatSkillLine).join("\n")}`);
    }
    return `The following skills are available. Read a skill's SKILL.md with the read_file tool for full instructions.

${parts.join("\n\n")}`;
  } catch (error) {
    log_default.error(error);
    return null;
  }
}
var cliRegistry = [];
async function getXClawClis(enabledClis) {
  try {
    const candidates = enabledClis ? cliRegistry.filter((c) => enabledClis.includes(c.name)) : cliRegistry;
    if (candidates.length === 0)
      return null;
    const sections = (await Promise.all(candidates.map((c) => c.getSection()))).filter((s) => s !== null);
    if (sections.length === 0)
      return null;
    return [
      "## XClaw CLI",
      "The following CLI tools are available. Run them via the bash tool.",
      "",
      ...sections
    ].join("\n");
  } catch (error) {
    log_default.error(error);
    return null;
  }
}
var CONTEXT_SECTION_TITLES = {
  directoryStructure: "Directory Structure",
  gitStatus: "Git Status",
  xclawMemory: "XClaw Memory",
  xclawFiles: "XClaw Files",
  readme: "Readme",
  skills: "Skills"
};
var getContext = memoize_default(async (session) => {
  const [xclawMemory, gitStatus, directoryStructure, xclawFiles, readme, skills] = await Promise.all([
    getXClawMemory(session),
    getGitStatus(session),
    getDirectoryStructure(session),
    getXClawFiles(session),
    getReadme(session),
    getAvailableSkills(session)
  ]);
  const section = (id, body) => body ? { [id]: { title: CONTEXT_SECTION_TITLES[id], body } } : {};
  return {
    ...section("directoryStructure", directoryStructure),
    ...section("gitStatus", gitStatus),
    ...section("xclawMemory", xclawMemory),
    ...section("xclawFiles", xclawFiles),
    ...section("readme", readme),
    ...section("skills", skills)
  };
});
function formatContext(context, session) {
  if (Object.entries(context).length === 0)
    return "";
  if (session.includeGitStatus === false && context.gitStatus) {
    delete context.gitStatus;
  }
  const sections = Object.values(context).filter((s) => Boolean(s)).map(({ title, body }) => `### ${title}
${body}`);
  return ["## Context Info", ...sections].join("\n\n");
}
var getDirectoryStructure = memoize_default(async (session) => {
  let lines;
  try {
    const abortController = new AbortController();
    setTimeout(() => {
      abortController.abort();
    }, 1e3);
    lines = await ls(session.rootWorkingDir, abortController, session.rootWorkingDir);
  } catch (error) {
    log_default.error(error);
    return "";
  }
  return [
    `Top-level entries of this project. Use the bash tool to explore subdirectories. This listing will NOT update during the conversation.`,
    lines
  ].join("\n");
});

// package.json
var package_default = {
  name: "@xclaw-computer/server",
  version: "0.2.22",
  type: "module",
  main: "src/index.ts",
  scripts: {
    test: "dotenv -e ../client/.env -- vitest --config vitest.config.unit.ts",
    "test:e2e-hades": "dotenv -e ../client/.env -- vitest src/__tests__/e2e-hades.test.ts",
    "test:e2e-hades-training": "dotenv -e ../client/.env -- vitest src/__tests__/e2e-hades-training.test.ts",
    "test:e2e-binary": "vitest src/__tests__/e2e-binary.test.ts",
    "test:e2e-local": "vitest src/__tests__/e2e-local.test.ts",
    "test:e2e-server-binary": "vitest src/__tests__/e2e-server-binary.test.ts",
    start: "tsx src/index.ts",
    lint: "eslint . --ext .ts",
    typecheck: "tsc --noEmit -p tsconfig.json",
    prettier: "prettier --config .prettierrc --write .",
    build: "tsc -p tsconfig.build.json",
    "build:bundle": `npm run build && esbuild build/index.js --bundle --platform=node --format=esm --outfile=dist/server-bundle.mjs --target=node22 --external:dtrace-provider --banner:js="import { createRequire as _cr } from 'module'; import { fileURLToPath as _fu } from 'url'; import { dirname as _dn } from 'path'; const require = _cr(import.meta.url); const __filename = _fu(import.meta.url); const __dirname = _dn(__filename);"`,
    docker: "npm run typecheck && npm run lint && npm run build && ./image-builder build --push . --cloud=gcp",
    "test:single": "dotenv -e ../client/.env -- vitest",
    "test:oom-stress": "OOM_STRESS=1 NODE_OPTIONS='--expose-gc' dotenv -e ../client/.env -- vitest run --config vitest.config.unit.ts --pool=forks --no-file-parallelism --isolate src/utils/__tests__/TransientShell.oom.test.ts src/__tests__/server-oom.test.ts",
    "oom:repro": "npm run build && node --expose-gc scripts/oom-repro.mjs",
    "bench:worktrees": "tsx src/utils/worktrees/bench/run.ts",
    "bench:worktrees-overhead": "tsx src/utils/worktrees/bench/lib_overhead.ts",
    "bench:ls": "tsx src/utils/bench/ls.ts",
    "bench:get-context": "tsx src/utils/bench/getContext.ts",
    "generate:bundled-skills": "node scripts/generate-bundled-skills.mjs",
    "validate:skills": "node scripts/validate-skills.mjs",
    "validate:bundled-skills": "node scripts/generate-bundled-skills.mjs --check",
    "export:tool-descriptions": "npx tsx scripts/export-tool-descriptions.mjs",
    "build:binary": "npm run generate:bundled-skills && bun build ./src/binary.ts --compile --outfile dist/xclaw-computer-mcp-darwin-arm64 --target bun-darwin-arm64 && bun build ./src/binary.ts --compile --outfile dist/xclaw-computer-mcp-linux-x64 --target bun-linux-x64 && bun build ./src/binary.ts --compile --outfile dist/xclaw-computer-mcp-windows-x64 --target bun-windows-x64",
    "build:node-binary": `npm run generate:bundled-skills && npm run build && esbuild build/binary.js --bundle --platform=node --format=esm --outfile=dist/xclaw-computer-mcp.mjs --target=node22 --external:dtrace-provider --banner:js="import { createRequire as _cr } from 'module'; import { fileURLToPath as _fu } from 'url'; import { dirname as _dn } from 'path'; const require = _cr(import.meta.url); const __filename = _fu(import.meta.url); const __dirname = _dn(__filename);"`,
    "build:server-binary": "npm run generate:bundled-skills && bun build ./src/index.ts --compile --outfile dist/xclaw-computer-server-linux-x64 --target bun-linux-x64",
    "build:node-server-binary": `npm run generate:bundled-skills && npm run build && esbuild build/index.js --bundle --platform=node --format=esm --outfile=dist/xclaw-computer-server.mjs --target=node22 --external:dtrace-provider --banner:js="import { createRequire as _cr } from 'module'; import { fileURLToPath as _fu } from 'url'; import { dirname as _dn } from 'path'; const require = _cr(import.meta.url); const __filename = _fu(import.meta.url); const __dirname = _dn(__filename);"`
  },
  volta: {
    node: "24.11.0"
  },
  keywords: [],
  author: "",
  license: "ISC",
  description: "",
  dependencies: {
    "@modelcontextprotocol/sdk": "^1.17.3",
    "ansi-escapes": "^7.0.0",
    bunyan: "^1.8.15",
    "bunyan-format": "^0.2.1",
    cheerio: "^1.1.2",
    "chrome-remote-interface": "^0.33.3",
    cors: "^2.8.5",
    debug: "^4.4.1",
    diff: "^8.0.2",
    domhandler: "^5.0.3",
    express: "^5.1.0",
    fflate: "^0.8.2",
    glob: "^11.0.3",
    jimp: "^0.22.12",
    "lodash-es": "^4.17.21",
    "lru-cache": "^11.1.0",
    rxjs: "^7.8.1",
    "shell-quote": "^1.8.3",
    "spawn-rx": "^5.1.2",
    "supports-color": "^10.2.0",
    typescript: "^5.9.3",
    zod: "^3.25.76",
    "zod-to-json-schema": "^3.24.6"
  },
  devDependencies: {
    "@xclaw-computer/client": "file:../client",
    "@types/bunyan": "^1.8.11",
    "@types/bunyan-format": "^0.2.1",
    "@types/chrome-remote-interface": "^0.31.14",
    "@types/cors": "^2.8.19",
    "@types/debug": "^4.1.12",
    "@types/express": "^5.0.3",
    "@types/lodash-es": "^4.17.12",
    "@types/node": "^24.3.0",
    "@types/shell-quote": "^1.7.5",
    "@types/supertest": "^6.0.3",
    "@typescript-eslint/eslint-plugin": "^8.42.0",
    "@typescript-eslint/parser": "^8.42.0",
    "@vitest/coverage-v8": "^3.2.4",
    "@vitest/ui": "^3.2.4",
    "dotenv-cli": "^10.0.0",
    eslint: "^9.6.1",
    "eslint-config-prettier": "^8.10.2",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import": "^2.32.0",
    jsdom: "^26.1.0",
    prettier: "^3.3.3",
    supertest: "^7.1.4",
    "ts-node": "^10.9.2",
    tsx: "^4.19.0",
    "typescript-eslint": "^8.42.0",
    vite: "^5.4.1",
    "vite-tsconfig-paths": "^4.3.2",
    vitest: "^3.2.4"
  }
};

// node_modules/zod-to-json-schema/dist/esm/Options.js
var ignoreOverride = Symbol("Let zodToJsonSchema decide on which parser to use");
var defaultOptions = {
  name: void 0,
  $refStrategy: "root",
  basePath: ["#"],
  effectStrategy: "input",
  pipeStrategy: "all",
  dateStrategy: "format:date-time",
  mapStrategy: "entries",
  removeAdditionalStrategy: "passthrough",
  allowedAdditionalProperties: true,
  rejectedAdditionalProperties: false,
  definitionPath: "definitions",
  target: "jsonSchema7",
  strictUnions: false,
  definitions: {},
  errorMessages: false,
  markdownDescription: false,
  patternStrategy: "escape",
  applyRegexFlags: false,
  emailStrategy: "format:email",
  base64Strategy: "contentEncoding:base64",
  nameStrategy: "ref",
  openAiAnyTypeName: "OpenAiAnyType"
};
var getDefaultOptions = (options) => typeof options === "string" ? {
  ...defaultOptions,
  name: options
} : {
  ...defaultOptions,
  ...options
};

// node_modules/zod-to-json-schema/dist/esm/Refs.js
var getRefs = (options) => {
  const _options = getDefaultOptions(options);
  const currentPath = _options.name !== void 0 ? [..._options.basePath, _options.definitionPath, _options.name] : _options.basePath;
  return {
    ..._options,
    flags: { hasReferencedOpenAiAnyType: false },
    currentPath,
    propertyPath: void 0,
    seen: new Map(Object.entries(_options.definitions).map(([name, def]) => [
      def._def,
      {
        def: def._def,
        path: [..._options.basePath, _options.definitionPath, name],
        // Resolution of references will be forced even though seen, so it's ok that the schema is undefined here for now.
        jsonSchema: void 0
      }
    ]))
  };
};

// node_modules/zod-to-json-schema/dist/esm/errorMessages.js
function addErrorMessage(res, key, errorMessage, refs) {
  if (!refs?.errorMessages)
    return;
  if (errorMessage) {
    res.errorMessage = {
      ...res.errorMessage,
      [key]: errorMessage
    };
  }
}
function setResponseValueAndErrors(res, key, value, errorMessage, refs) {
  res[key] = value;
  addErrorMessage(res, key, errorMessage, refs);
}

// node_modules/zod-to-json-schema/dist/esm/getRelativePath.js
var getRelativePath = (pathA, pathB) => {
  let i = 0;
  for (; i < pathA.length && i < pathB.length; i++) {
    if (pathA[i] !== pathB[i])
      break;
  }
  return [(pathA.length - i).toString(), ...pathB.slice(i)].join("/");
};

// node_modules/zod-to-json-schema/dist/esm/parsers/any.js
function parseAnyDef(refs) {
  if (refs.target !== "openAi") {
    return {};
  }
  const anyDefinitionPath = [
    ...refs.basePath,
    refs.definitionPath,
    refs.openAiAnyTypeName
  ];
  refs.flags.hasReferencedOpenAiAnyType = true;
  return {
    $ref: refs.$refStrategy === "relative" ? getRelativePath(anyDefinitionPath, refs.currentPath) : anyDefinitionPath.join("/")
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/array.js
function parseArrayDef(def, refs) {
  const res = {
    type: "array"
  };
  if (def.type?._def && def.type?._def?.typeName !== ZodFirstPartyTypeKind.ZodAny) {
    res.items = parseDef(def.type._def, {
      ...refs,
      currentPath: [...refs.currentPath, "items"]
    });
  }
  if (def.minLength) {
    setResponseValueAndErrors(res, "minItems", def.minLength.value, def.minLength.message, refs);
  }
  if (def.maxLength) {
    setResponseValueAndErrors(res, "maxItems", def.maxLength.value, def.maxLength.message, refs);
  }
  if (def.exactLength) {
    setResponseValueAndErrors(res, "minItems", def.exactLength.value, def.exactLength.message, refs);
    setResponseValueAndErrors(res, "maxItems", def.exactLength.value, def.exactLength.message, refs);
  }
  return res;
}

// node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js
function parseBigintDef(def, refs) {
  const res = {
    type: "integer",
    format: "int64"
  };
  if (!def.checks)
    return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "min":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMinimum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMinimum = true;
          }
          setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
        }
        break;
      case "max":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMaximum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMaximum = true;
          }
          setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
        }
        break;
      case "multipleOf":
        setResponseValueAndErrors(res, "multipleOf", check.value, check.message, refs);
        break;
    }
  }
  return res;
}

// node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js
function parseBooleanDef() {
  return {
    type: "boolean"
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/branded.js
function parseBrandedDef(_def, refs) {
  return parseDef(_def.type._def, refs);
}

// node_modules/zod-to-json-schema/dist/esm/parsers/catch.js
var parseCatchDef = (def, refs) => {
  return parseDef(def.innerType._def, refs);
};

// node_modules/zod-to-json-schema/dist/esm/parsers/date.js
function parseDateDef(def, refs, overrideDateStrategy) {
  const strategy = overrideDateStrategy ?? refs.dateStrategy;
  if (Array.isArray(strategy)) {
    return {
      anyOf: strategy.map((item, i) => parseDateDef(def, refs, item))
    };
  }
  switch (strategy) {
    case "string":
    case "format:date-time":
      return {
        type: "string",
        format: "date-time"
      };
    case "format:date":
      return {
        type: "string",
        format: "date"
      };
    case "integer":
      return integerDateParser(def, refs);
  }
}
var integerDateParser = (def, refs) => {
  const res = {
    type: "integer",
    format: "unix-time"
  };
  if (refs.target === "openApi3") {
    return res;
  }
  for (const check of def.checks) {
    switch (check.kind) {
      case "min":
        setResponseValueAndErrors(
          res,
          "minimum",
          check.value,
          // This is in milliseconds
          check.message,
          refs
        );
        break;
      case "max":
        setResponseValueAndErrors(
          res,
          "maximum",
          check.value,
          // This is in milliseconds
          check.message,
          refs
        );
        break;
    }
  }
  return res;
};

// node_modules/zod-to-json-schema/dist/esm/parsers/default.js
function parseDefaultDef(_def, refs) {
  return {
    ...parseDef(_def.innerType._def, refs),
    default: _def.defaultValue()
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/effects.js
function parseEffectsDef(_def, refs) {
  return refs.effectStrategy === "input" ? parseDef(_def.schema._def, refs) : parseAnyDef(refs);
}

// node_modules/zod-to-json-schema/dist/esm/parsers/enum.js
function parseEnumDef(def) {
  return {
    type: "string",
    enum: Array.from(def.values)
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js
var isJsonSchema7AllOfType = (type) => {
  if ("type" in type && type.type === "string")
    return false;
  return "allOf" in type;
};
function parseIntersectionDef(def, refs) {
  const allOf = [
    parseDef(def.left._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "0"]
    }),
    parseDef(def.right._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "1"]
    })
  ].filter((x) => !!x);
  let unevaluatedProperties = refs.target === "jsonSchema2019-09" ? { unevaluatedProperties: false } : void 0;
  const mergedAllOf = [];
  allOf.forEach((schema2) => {
    if (isJsonSchema7AllOfType(schema2)) {
      mergedAllOf.push(...schema2.allOf);
      if (schema2.unevaluatedProperties === void 0) {
        unevaluatedProperties = void 0;
      }
    } else {
      let nestedSchema = schema2;
      if ("additionalProperties" in schema2 && schema2.additionalProperties === false) {
        const { additionalProperties, ...rest } = schema2;
        nestedSchema = rest;
      } else {
        unevaluatedProperties = void 0;
      }
      mergedAllOf.push(nestedSchema);
    }
  });
  return mergedAllOf.length ? {
    allOf: mergedAllOf,
    ...unevaluatedProperties
  } : void 0;
}

// node_modules/zod-to-json-schema/dist/esm/parsers/literal.js
function parseLiteralDef(def, refs) {
  const parsedType = typeof def.value;
  if (parsedType !== "bigint" && parsedType !== "number" && parsedType !== "boolean" && parsedType !== "string") {
    return {
      type: Array.isArray(def.value) ? "array" : "object"
    };
  }
  if (refs.target === "openApi3") {
    return {
      type: parsedType === "bigint" ? "integer" : parsedType,
      enum: [def.value]
    };
  }
  return {
    type: parsedType === "bigint" ? "integer" : parsedType,
    const: def.value
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var emojiRegex2 = void 0;
var zodPatterns = {
  /**
   * `c` was changed to `[cC]` to replicate /i flag
   */
  cuid: /^[cC][^\s-]{8,}$/,
  cuid2: /^[0-9a-z]+$/,
  ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
  /**
   * `a-z` was added to replicate /i flag
   */
  email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/,
  /**
   * Constructed a valid Unicode RegExp
   *
   * Lazily instantiate since this type of regex isn't supported
   * in all envs (e.g. React Native).
   *
   * See:
   * https://github.com/colinhacks/zod/issues/2433
   * Fix in Zod:
   * https://github.com/colinhacks/zod/commit/9340fd51e48576a75adc919bff65dbc4a5d4c99b
   */
  emoji: () => {
    if (emojiRegex2 === void 0) {
      emojiRegex2 = RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u");
    }
    return emojiRegex2;
  },
  /**
   * Unused
   */
  uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
  /**
   * Unused
   */
  ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/,
  /**
   * Unused
   */
  ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,
  ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,
  base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/,
  nanoid: /^[a-zA-Z0-9_-]{21}$/,
  jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
};
function parseStringDef(def, refs) {
  const res = {
    type: "string"
  };
  if (def.checks) {
    for (const check of def.checks) {
      switch (check.kind) {
        case "min":
          setResponseValueAndErrors(res, "minLength", typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value, check.message, refs);
          break;
        case "max":
          setResponseValueAndErrors(res, "maxLength", typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value, check.message, refs);
          break;
        case "email":
          switch (refs.emailStrategy) {
            case "format:email":
              addFormat(res, "email", check.message, refs);
              break;
            case "format:idn-email":
              addFormat(res, "idn-email", check.message, refs);
              break;
            case "pattern:zod":
              addPattern(res, zodPatterns.email, check.message, refs);
              break;
          }
          break;
        case "url":
          addFormat(res, "uri", check.message, refs);
          break;
        case "uuid":
          addFormat(res, "uuid", check.message, refs);
          break;
        case "regex":
          addPattern(res, check.regex, check.message, refs);
          break;
        case "cuid":
          addPattern(res, zodPatterns.cuid, check.message, refs);
          break;
        case "cuid2":
          addPattern(res, zodPatterns.cuid2, check.message, refs);
          break;
        case "startsWith":
          addPattern(res, RegExp(`^${escapeLiteralCheckValue(check.value, refs)}`), check.message, refs);
          break;
        case "endsWith":
          addPattern(res, RegExp(`${escapeLiteralCheckValue(check.value, refs)}$`), check.message, refs);
          break;
        case "datetime":
          addFormat(res, "date-time", check.message, refs);
          break;
        case "date":
          addFormat(res, "date", check.message, refs);
          break;
        case "time":
          addFormat(res, "time", check.message, refs);
          break;
        case "duration":
          addFormat(res, "duration", check.message, refs);
          break;
        case "length":
          setResponseValueAndErrors(res, "minLength", typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value, check.message, refs);
          setResponseValueAndErrors(res, "maxLength", typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value, check.message, refs);
          break;
        case "includes": {
          addPattern(res, RegExp(escapeLiteralCheckValue(check.value, refs)), check.message, refs);
          break;
        }
        case "ip": {
          if (check.version !== "v6") {
            addFormat(res, "ipv4", check.message, refs);
          }
          if (check.version !== "v4") {
            addFormat(res, "ipv6", check.message, refs);
          }
          break;
        }
        case "base64url":
          addPattern(res, zodPatterns.base64url, check.message, refs);
          break;
        case "jwt":
          addPattern(res, zodPatterns.jwt, check.message, refs);
          break;
        case "cidr": {
          if (check.version !== "v6") {
            addPattern(res, zodPatterns.ipv4Cidr, check.message, refs);
          }
          if (check.version !== "v4") {
            addPattern(res, zodPatterns.ipv6Cidr, check.message, refs);
          }
          break;
        }
        case "emoji":
          addPattern(res, zodPatterns.emoji(), check.message, refs);
          break;
        case "ulid": {
          addPattern(res, zodPatterns.ulid, check.message, refs);
          break;
        }
        case "base64": {
          switch (refs.base64Strategy) {
            case "format:binary": {
              addFormat(res, "binary", check.message, refs);
              break;
            }
            case "contentEncoding:base64": {
              setResponseValueAndErrors(res, "contentEncoding", "base64", check.message, refs);
              break;
            }
            case "pattern:zod": {
              addPattern(res, zodPatterns.base64, check.message, refs);
              break;
            }
          }
          break;
        }
        case "nanoid": {
          addPattern(res, zodPatterns.nanoid, check.message, refs);
        }
        case "toLowerCase":
        case "toUpperCase":
        case "trim":
          break;
        default:
          /* @__PURE__ */ ((_) => {
          })(check);
      }
    }
  }
  return res;
}
function escapeLiteralCheckValue(literal, refs) {
  return refs.patternStrategy === "escape" ? escapeNonAlphaNumeric(literal) : literal;
}
var ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
function escapeNonAlphaNumeric(source) {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (!ALPHA_NUMERIC.has(source[i])) {
      result += "\\";
    }
    result += source[i];
  }
  return result;
}
function addFormat(schema2, value, message, refs) {
  if (schema2.format || schema2.anyOf?.some((x) => x.format)) {
    if (!schema2.anyOf) {
      schema2.anyOf = [];
    }
    if (schema2.format) {
      schema2.anyOf.push({
        format: schema2.format,
        ...schema2.errorMessage && refs.errorMessages && {
          errorMessage: { format: schema2.errorMessage.format }
        }
      });
      delete schema2.format;
      if (schema2.errorMessage) {
        delete schema2.errorMessage.format;
        if (Object.keys(schema2.errorMessage).length === 0) {
          delete schema2.errorMessage;
        }
      }
    }
    schema2.anyOf.push({
      format: value,
      ...message && refs.errorMessages && { errorMessage: { format: message } }
    });
  } else {
    setResponseValueAndErrors(schema2, "format", value, message, refs);
  }
}
function addPattern(schema2, regex, message, refs) {
  if (schema2.pattern || schema2.allOf?.some((x) => x.pattern)) {
    if (!schema2.allOf) {
      schema2.allOf = [];
    }
    if (schema2.pattern) {
      schema2.allOf.push({
        pattern: schema2.pattern,
        ...schema2.errorMessage && refs.errorMessages && {
          errorMessage: { pattern: schema2.errorMessage.pattern }
        }
      });
      delete schema2.pattern;
      if (schema2.errorMessage) {
        delete schema2.errorMessage.pattern;
        if (Object.keys(schema2.errorMessage).length === 0) {
          delete schema2.errorMessage;
        }
      }
    }
    schema2.allOf.push({
      pattern: stringifyRegExpWithFlags(regex, refs),
      ...message && refs.errorMessages && { errorMessage: { pattern: message } }
    });
  } else {
    setResponseValueAndErrors(schema2, "pattern", stringifyRegExpWithFlags(regex, refs), message, refs);
  }
}
function stringifyRegExpWithFlags(regex, refs) {
  if (!refs.applyRegexFlags || !regex.flags) {
    return regex.source;
  }
  const flags = {
    i: regex.flags.includes("i"),
    m: regex.flags.includes("m"),
    s: regex.flags.includes("s")
    // `.` matches newlines
  };
  const source = flags.i ? regex.source.toLowerCase() : regex.source;
  let pattern = "";
  let isEscaped = false;
  let inCharGroup = false;
  let inCharRange = false;
  for (let i = 0; i < source.length; i++) {
    if (isEscaped) {
      pattern += source[i];
      isEscaped = false;
      continue;
    }
    if (flags.i) {
      if (inCharGroup) {
        if (source[i].match(/[a-z]/)) {
          if (inCharRange) {
            pattern += source[i];
            pattern += `${source[i - 2]}-${source[i]}`.toUpperCase();
            inCharRange = false;
          } else if (source[i + 1] === "-" && source[i + 2]?.match(/[a-z]/)) {
            pattern += source[i];
            inCharRange = true;
          } else {
            pattern += `${source[i]}${source[i].toUpperCase()}`;
          }
          continue;
        }
      } else if (source[i].match(/[a-z]/)) {
        pattern += `[${source[i]}${source[i].toUpperCase()}]`;
        continue;
      }
    }
    if (flags.m) {
      if (source[i] === "^") {
        pattern += `(^|(?<=[\r
]))`;
        continue;
      } else if (source[i] === "$") {
        pattern += `($|(?=[\r
]))`;
        continue;
      }
    }
    if (flags.s && source[i] === ".") {
      pattern += inCharGroup ? `${source[i]}\r
` : `[${source[i]}\r
]`;
      continue;
    }
    pattern += source[i];
    if (source[i] === "\\") {
      isEscaped = true;
    } else if (inCharGroup && source[i] === "]") {
      inCharGroup = false;
    } else if (!inCharGroup && source[i] === "[") {
      inCharGroup = true;
    }
  }
  try {
    new RegExp(pattern);
  } catch {
    console.warn(`Could not convert regex pattern at ${refs.currentPath.join("/")} to a flag-independent form! Falling back to the flag-ignorant source`);
    return regex.source;
  }
  return pattern;
}

// node_modules/zod-to-json-schema/dist/esm/parsers/record.js
function parseRecordDef(def, refs) {
  if (refs.target === "openAi") {
    console.warn("Warning: OpenAI may not support records in schemas! Try an array of key-value pairs instead.");
  }
  if (refs.target === "openApi3" && def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      type: "object",
      required: def.keyType._def.values,
      properties: def.keyType._def.values.reduce((acc, key) => ({
        ...acc,
        [key]: parseDef(def.valueType._def, {
          ...refs,
          currentPath: [...refs.currentPath, "properties", key]
        }) ?? parseAnyDef(refs)
      }), {}),
      additionalProperties: refs.rejectedAdditionalProperties
    };
  }
  const schema2 = {
    type: "object",
    additionalProperties: parseDef(def.valueType._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    }) ?? refs.allowedAdditionalProperties
  };
  if (refs.target === "openApi3") {
    return schema2;
  }
  if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodString && def.keyType._def.checks?.length) {
    const { type, ...keyType } = parseStringDef(def.keyType._def, refs);
    return {
      ...schema2,
      propertyNames: keyType
    };
  } else if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      ...schema2,
      propertyNames: {
        enum: def.keyType._def.values
      }
    };
  } else if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodBranded && def.keyType._def.type._def.typeName === ZodFirstPartyTypeKind.ZodString && def.keyType._def.type._def.checks?.length) {
    const { type, ...keyType } = parseBrandedDef(def.keyType._def, refs);
    return {
      ...schema2,
      propertyNames: keyType
    };
  }
  return schema2;
}

// node_modules/zod-to-json-schema/dist/esm/parsers/map.js
function parseMapDef(def, refs) {
  if (refs.mapStrategy === "record") {
    return parseRecordDef(def, refs);
  }
  const keys = parseDef(def.keyType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "0"]
  }) || parseAnyDef(refs);
  const values = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "1"]
  }) || parseAnyDef(refs);
  return {
    type: "array",
    maxItems: 125,
    items: {
      type: "array",
      items: [keys, values],
      minItems: 2,
      maxItems: 2
    }
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js
function parseNativeEnumDef(def) {
  const object = def.values;
  const actualKeys = Object.keys(def.values).filter((key) => {
    return typeof object[object[key]] !== "number";
  });
  const actualValues = actualKeys.map((key) => object[key]);
  const parsedTypes = Array.from(new Set(actualValues.map((values) => typeof values)));
  return {
    type: parsedTypes.length === 1 ? parsedTypes[0] === "string" ? "string" : "number" : ["string", "number"],
    enum: actualValues
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/never.js
function parseNeverDef(refs) {
  return refs.target === "openAi" ? void 0 : {
    not: parseAnyDef({
      ...refs,
      currentPath: [...refs.currentPath, "not"]
    })
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/null.js
function parseNullDef(refs) {
  return refs.target === "openApi3" ? {
    enum: ["null"],
    nullable: true
  } : {
    type: "null"
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/union.js
var primitiveMappings = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBigInt: "integer",
  ZodBoolean: "boolean",
  ZodNull: "null"
};
function parseUnionDef(def, refs) {
  if (refs.target === "openApi3")
    return asAnyOf(def, refs);
  const options = def.options instanceof Map ? Array.from(def.options.values()) : def.options;
  if (options.every((x) => x._def.typeName in primitiveMappings && (!x._def.checks || !x._def.checks.length))) {
    const types2 = options.reduce((types3, x) => {
      const type = primitiveMappings[x._def.typeName];
      return type && !types3.includes(type) ? [...types3, type] : types3;
    }, []);
    return {
      type: types2.length > 1 ? types2 : types2[0]
    };
  } else if (options.every((x) => x._def.typeName === "ZodLiteral" && !x.description)) {
    const types2 = options.reduce((acc, x) => {
      const type = typeof x._def.value;
      switch (type) {
        case "string":
        case "number":
        case "boolean":
          return [...acc, type];
        case "bigint":
          return [...acc, "integer"];
        case "object":
          if (x._def.value === null)
            return [...acc, "null"];
        case "symbol":
        case "undefined":
        case "function":
        default:
          return acc;
      }
    }, []);
    if (types2.length === options.length) {
      const uniqueTypes = types2.filter((x, i, a) => a.indexOf(x) === i);
      return {
        type: uniqueTypes.length > 1 ? uniqueTypes : uniqueTypes[0],
        enum: options.reduce((acc, x) => {
          return acc.includes(x._def.value) ? acc : [...acc, x._def.value];
        }, [])
      };
    }
  } else if (options.every((x) => x._def.typeName === "ZodEnum")) {
    return {
      type: "string",
      enum: options.reduce((acc, x) => [
        ...acc,
        ...x._def.values.filter((x2) => !acc.includes(x2))
      ], [])
    };
  }
  return asAnyOf(def, refs);
}
var asAnyOf = (def, refs) => {
  const anyOf = (def.options instanceof Map ? Array.from(def.options.values()) : def.options).map((x, i) => parseDef(x._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", `${i}`]
  })).filter((x) => !!x && (!refs.strictUnions || typeof x === "object" && Object.keys(x).length > 0));
  return anyOf.length ? { anyOf } : void 0;
};

// node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js
function parseNullableDef(def, refs) {
  if (["ZodString", "ZodNumber", "ZodBigInt", "ZodBoolean", "ZodNull"].includes(def.innerType._def.typeName) && (!def.innerType._def.checks || !def.innerType._def.checks.length)) {
    if (refs.target === "openApi3") {
      return {
        type: primitiveMappings[def.innerType._def.typeName],
        nullable: true
      };
    }
    return {
      type: [
        primitiveMappings[def.innerType._def.typeName],
        "null"
      ]
    };
  }
  if (refs.target === "openApi3") {
    const base2 = parseDef(def.innerType._def, {
      ...refs,
      currentPath: [...refs.currentPath]
    });
    if (base2 && "$ref" in base2)
      return { allOf: [base2], nullable: true };
    return base2 && { ...base2, nullable: true };
  }
  const base = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", "0"]
  });
  return base && { anyOf: [base, { type: "null" }] };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/number.js
function parseNumberDef(def, refs) {
  const res = {
    type: "number"
  };
  if (!def.checks)
    return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "int":
        res.type = "integer";
        addErrorMessage(res, "type", check.message, refs);
        break;
      case "min":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMinimum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMinimum = true;
          }
          setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
        }
        break;
      case "max":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMaximum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMaximum = true;
          }
          setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
        }
        break;
      case "multipleOf":
        setResponseValueAndErrors(res, "multipleOf", check.value, check.message, refs);
        break;
    }
  }
  return res;
}

// node_modules/zod-to-json-schema/dist/esm/parsers/object.js
function parseObjectDef(def, refs) {
  const forceOptionalIntoNullable = refs.target === "openAi";
  const result = {
    type: "object",
    properties: {}
  };
  const required = [];
  const shape = def.shape();
  for (const propName in shape) {
    let propDef = shape[propName];
    if (propDef === void 0 || propDef._def === void 0) {
      continue;
    }
    let propOptional = safeIsOptional(propDef);
    if (propOptional && forceOptionalIntoNullable) {
      if (propDef._def.typeName === "ZodOptional") {
        propDef = propDef._def.innerType;
      }
      if (!propDef.isNullable()) {
        propDef = propDef.nullable();
      }
      propOptional = false;
    }
    const parsedDef = parseDef(propDef._def, {
      ...refs,
      currentPath: [...refs.currentPath, "properties", propName],
      propertyPath: [...refs.currentPath, "properties", propName]
    });
    if (parsedDef === void 0) {
      continue;
    }
    result.properties[propName] = parsedDef;
    if (!propOptional) {
      required.push(propName);
    }
  }
  if (required.length) {
    result.required = required;
  }
  const additionalProperties = decideAdditionalProperties(def, refs);
  if (additionalProperties !== void 0) {
    result.additionalProperties = additionalProperties;
  }
  return result;
}
function decideAdditionalProperties(def, refs) {
  if (def.catchall._def.typeName !== "ZodNever") {
    return parseDef(def.catchall._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    });
  }
  switch (def.unknownKeys) {
    case "passthrough":
      return refs.allowedAdditionalProperties;
    case "strict":
      return refs.rejectedAdditionalProperties;
    case "strip":
      return refs.removeAdditionalStrategy === "strict" ? refs.allowedAdditionalProperties : refs.rejectedAdditionalProperties;
  }
}
function safeIsOptional(schema2) {
  try {
    return schema2.isOptional();
  } catch {
    return true;
  }
}

// node_modules/zod-to-json-schema/dist/esm/parsers/optional.js
var parseOptionalDef = (def, refs) => {
  if (refs.currentPath.toString() === refs.propertyPath?.toString()) {
    return parseDef(def.innerType._def, refs);
  }
  const innerSchema = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", "1"]
  });
  return innerSchema ? {
    anyOf: [
      {
        not: parseAnyDef(refs)
      },
      innerSchema
    ]
  } : parseAnyDef(refs);
};

// node_modules/zod-to-json-schema/dist/esm/parsers/pipeline.js
var parsePipelineDef = (def, refs) => {
  if (refs.pipeStrategy === "input") {
    return parseDef(def.in._def, refs);
  } else if (refs.pipeStrategy === "output") {
    return parseDef(def.out._def, refs);
  }
  const a = parseDef(def.in._def, {
    ...refs,
    currentPath: [...refs.currentPath, "allOf", "0"]
  });
  const b = parseDef(def.out._def, {
    ...refs,
    currentPath: [...refs.currentPath, "allOf", a ? "1" : "0"]
  });
  return {
    allOf: [a, b].filter((x) => x !== void 0)
  };
};

// node_modules/zod-to-json-schema/dist/esm/parsers/promise.js
function parsePromiseDef(def, refs) {
  return parseDef(def.type._def, refs);
}

// node_modules/zod-to-json-schema/dist/esm/parsers/set.js
function parseSetDef(def, refs) {
  const items = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items"]
  });
  const schema2 = {
    type: "array",
    uniqueItems: true,
    items
  };
  if (def.minSize) {
    setResponseValueAndErrors(schema2, "minItems", def.minSize.value, def.minSize.message, refs);
  }
  if (def.maxSize) {
    setResponseValueAndErrors(schema2, "maxItems", def.maxSize.value, def.maxSize.message, refs);
  }
  return schema2;
}

// node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js
function parseTupleDef(def, refs) {
  if (def.rest) {
    return {
      type: "array",
      minItems: def.items.length,
      items: def.items.map((x, i) => parseDef(x._def, {
        ...refs,
        currentPath: [...refs.currentPath, "items", `${i}`]
      })).reduce((acc, x) => x === void 0 ? acc : [...acc, x], []),
      additionalItems: parseDef(def.rest._def, {
        ...refs,
        currentPath: [...refs.currentPath, "additionalItems"]
      })
    };
  } else {
    return {
      type: "array",
      minItems: def.items.length,
      maxItems: def.items.length,
      items: def.items.map((x, i) => parseDef(x._def, {
        ...refs,
        currentPath: [...refs.currentPath, "items", `${i}`]
      })).reduce((acc, x) => x === void 0 ? acc : [...acc, x], [])
    };
  }
}

// node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js
function parseUndefinedDef(refs) {
  return {
    not: parseAnyDef(refs)
  };
}

// node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js
function parseUnknownDef(refs) {
  return parseAnyDef(refs);
}

// node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js
var parseReadonlyDef = (def, refs) => {
  return parseDef(def.innerType._def, refs);
};

// node_modules/zod-to-json-schema/dist/esm/selectParser.js
var selectParser = (def, typeName, refs) => {
  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString:
      return parseStringDef(def, refs);
    case ZodFirstPartyTypeKind.ZodNumber:
      return parseNumberDef(def, refs);
    case ZodFirstPartyTypeKind.ZodObject:
      return parseObjectDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBigInt:
      return parseBigintDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBoolean:
      return parseBooleanDef();
    case ZodFirstPartyTypeKind.ZodDate:
      return parseDateDef(def, refs);
    case ZodFirstPartyTypeKind.ZodUndefined:
      return parseUndefinedDef(refs);
    case ZodFirstPartyTypeKind.ZodNull:
      return parseNullDef(refs);
    case ZodFirstPartyTypeKind.ZodArray:
      return parseArrayDef(def, refs);
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return parseUnionDef(def, refs);
    case ZodFirstPartyTypeKind.ZodIntersection:
      return parseIntersectionDef(def, refs);
    case ZodFirstPartyTypeKind.ZodTuple:
      return parseTupleDef(def, refs);
    case ZodFirstPartyTypeKind.ZodRecord:
      return parseRecordDef(def, refs);
    case ZodFirstPartyTypeKind.ZodLiteral:
      return parseLiteralDef(def, refs);
    case ZodFirstPartyTypeKind.ZodEnum:
      return parseEnumDef(def);
    case ZodFirstPartyTypeKind.ZodNativeEnum:
      return parseNativeEnumDef(def);
    case ZodFirstPartyTypeKind.ZodNullable:
      return parseNullableDef(def, refs);
    case ZodFirstPartyTypeKind.ZodOptional:
      return parseOptionalDef(def, refs);
    case ZodFirstPartyTypeKind.ZodMap:
      return parseMapDef(def, refs);
    case ZodFirstPartyTypeKind.ZodSet:
      return parseSetDef(def, refs);
    case ZodFirstPartyTypeKind.ZodLazy:
      return () => def.getter()._def;
    case ZodFirstPartyTypeKind.ZodPromise:
      return parsePromiseDef(def, refs);
    case ZodFirstPartyTypeKind.ZodNaN:
    case ZodFirstPartyTypeKind.ZodNever:
      return parseNeverDef(refs);
    case ZodFirstPartyTypeKind.ZodEffects:
      return parseEffectsDef(def, refs);
    case ZodFirstPartyTypeKind.ZodAny:
      return parseAnyDef(refs);
    case ZodFirstPartyTypeKind.ZodUnknown:
      return parseUnknownDef(refs);
    case ZodFirstPartyTypeKind.ZodDefault:
      return parseDefaultDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBranded:
      return parseBrandedDef(def, refs);
    case ZodFirstPartyTypeKind.ZodReadonly:
      return parseReadonlyDef(def, refs);
    case ZodFirstPartyTypeKind.ZodCatch:
      return parseCatchDef(def, refs);
    case ZodFirstPartyTypeKind.ZodPipeline:
      return parsePipelineDef(def, refs);
    case ZodFirstPartyTypeKind.ZodFunction:
    case ZodFirstPartyTypeKind.ZodVoid:
    case ZodFirstPartyTypeKind.ZodSymbol:
      return void 0;
    default:
      return /* @__PURE__ */ ((_) => void 0)(typeName);
  }
};

// node_modules/zod-to-json-schema/dist/esm/parseDef.js
function parseDef(def, refs, forceResolution = false) {
  const seenItem = refs.seen.get(def);
  if (refs.override) {
    const overrideResult = refs.override?.(def, refs, seenItem, forceResolution);
    if (overrideResult !== ignoreOverride) {
      return overrideResult;
    }
  }
  if (seenItem && !forceResolution) {
    const seenSchema = get$ref(seenItem, refs);
    if (seenSchema !== void 0) {
      return seenSchema;
    }
  }
  const newItem = { def, path: refs.currentPath, jsonSchema: void 0 };
  refs.seen.set(def, newItem);
  const jsonSchemaOrGetter = selectParser(def, def.typeName, refs);
  const jsonSchema = typeof jsonSchemaOrGetter === "function" ? parseDef(jsonSchemaOrGetter(), refs) : jsonSchemaOrGetter;
  if (jsonSchema) {
    addMeta(def, refs, jsonSchema);
  }
  if (refs.postProcess) {
    const postProcessResult = refs.postProcess(jsonSchema, def, refs);
    newItem.jsonSchema = jsonSchema;
    return postProcessResult;
  }
  newItem.jsonSchema = jsonSchema;
  return jsonSchema;
}
var get$ref = (item, refs) => {
  switch (refs.$refStrategy) {
    case "root":
      return { $ref: item.path.join("/") };
    case "relative":
      return { $ref: getRelativePath(refs.currentPath, item.path) };
    case "none":
    case "seen": {
      if (item.path.length < refs.currentPath.length && item.path.every((value, index) => refs.currentPath[index] === value)) {
        console.warn(`Recursive reference detected at ${refs.currentPath.join("/")}! Defaulting to any`);
        return parseAnyDef(refs);
      }
      return refs.$refStrategy === "seen" ? parseAnyDef(refs) : void 0;
    }
  }
};
var addMeta = (def, refs, jsonSchema) => {
  if (def.description) {
    jsonSchema.description = def.description;
    if (refs.markdownDescription) {
      jsonSchema.markdownDescription = def.description;
    }
  }
  return jsonSchema;
};

// node_modules/zod-to-json-schema/dist/esm/zodToJsonSchema.js
var zodToJsonSchema = (schema2, options) => {
  const refs = getRefs(options);
  let definitions = typeof options === "object" && options.definitions ? Object.entries(options.definitions).reduce((acc, [name2, schema3]) => ({
    ...acc,
    [name2]: parseDef(schema3._def, {
      ...refs,
      currentPath: [...refs.basePath, refs.definitionPath, name2]
    }, true) ?? parseAnyDef(refs)
  }), {}) : void 0;
  const name = typeof options === "string" ? options : options?.nameStrategy === "title" ? void 0 : options?.name;
  const main2 = parseDef(schema2._def, name === void 0 ? refs : {
    ...refs,
    currentPath: [...refs.basePath, refs.definitionPath, name]
  }, false) ?? parseAnyDef(refs);
  const title = typeof options === "object" && options.name !== void 0 && options.nameStrategy === "title" ? options.name : void 0;
  if (title !== void 0) {
    main2.title = title;
  }
  if (refs.flags.hasReferencedOpenAiAnyType) {
    if (!definitions) {
      definitions = {};
    }
    if (!definitions[refs.openAiAnyTypeName]) {
      definitions[refs.openAiAnyTypeName] = {
        // Skipping "object" as no properties can be defined and additionalProperties must be "false"
        type: ["string", "number", "integer", "boolean", "array", "null"],
        items: {
          $ref: refs.$refStrategy === "relative" ? "1" : [
            ...refs.basePath,
            refs.definitionPath,
            refs.openAiAnyTypeName
          ].join("/")
        }
      };
    }
  }
  const combined = name === void 0 ? definitions ? {
    ...main2,
    [refs.definitionPath]: definitions
  } : main2 : {
    $ref: [
      ...refs.$refStrategy === "relative" ? [] : refs.basePath,
      refs.definitionPath,
      name
    ].join("/"),
    [refs.definitionPath]: {
      ...definitions,
      [name]: main2
    }
  };
  if (refs.target === "jsonSchema7") {
    combined.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (refs.target === "jsonSchema2019-09" || refs.target === "openAi") {
    combined.$schema = "https://json-schema.org/draft/2019-09/schema#";
  }
  if (refs.target === "openAi" && ("anyOf" in combined || "oneOf" in combined || "allOf" in combined || "type" in combined && Array.isArray(combined.type))) {
    console.warn("Warning: OpenAI may not support schemas with unions as roots! Try wrapping it in an object property.");
  }
  return combined;
};

// build/tools/BashTool/bashTool.js
import { appendFile } from "fs/promises";
import { EOL } from "os";

// build/utils/unescape.js
function unescapeToolInput(str) {
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&#10;/g, "\n").replace(/&#13;/g, "\r").replace(/&#9;/g, "	");
}
function unescapeSequences(str) {
  return str.replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}
function unescapeSequencesOutsideStrings(str) {
  const stringRegex = /("(?:(?:\\.)|[^"\\])*")|('(?:(?:\\.)|[^'\\])*')|(`(?:(?:\\.)|[^`\\])*`)|("""(?:(?:\\.)|[^"\\])*""")|('''(?:(?:\\.)|[^'\\])*''')/g;
  const stringSpans = [];
  let match2;
  while ((match2 = stringRegex.exec(str)) !== null) {
    stringSpans.push({
      start: match2.index,
      end: match2.index + match2[0].length
    });
  }
  stringSpans.sort((a, b) => a.start - b.start);
  let result = "";
  let currentPos = 0;
  for (const span of stringSpans) {
    let outsidePart = str.substring(currentPos, span.start);
    outsidePart = unescapeSequences(outsidePart);
    result += outsidePart;
    const insidePart = str.substring(span.start, span.end);
    result += insidePart;
    currentPos = span.end;
  }
  let remaining = str.substring(currentPos);
  remaining = unescapeSequences(remaining);
  result += remaining;
  return result;
}
function unescapeHtmlOutsideStrings(str) {
  const stringRegex = /("(?:(?:\\.)|[^"\\])*")|('(?:(?:\\.)|[^'\\])*')|(`(?:(?:\\.)|[^`\\])*`)|("""(?:(?:\\.)|[^"\\])*""")|('''(?:(?:\\.)|[^'\\])*''')/g;
  const stringSpans = [];
  let match2;
  while ((match2 = stringRegex.exec(str)) !== null) {
    stringSpans.push({
      start: match2.index,
      end: match2.index + match2[0].length
    });
  }
  stringSpans.sort((a, b) => a.start - b.start);
  let result = "";
  let currentPos = 0;
  for (const span of stringSpans) {
    let outsidePart = str.substring(currentPos, span.start);
    outsidePart = unescapeToolInput(outsidePart);
    result += outsidePart;
    const insidePart = str.substring(span.start, span.end);
    result += insidePart;
    currentPos = span.end;
  }
  let remaining = str.substring(currentPos);
  remaining = unescapeToolInput(remaining);
  result += remaining;
  return result;
}
function fixEscapedString(str) {
  if (str.length === 0)
    return str;
  let result = unescapeHtmlOutsideStrings(str);
  result = unescapeSequencesOutsideStrings(result);
  return result;
}

// build/tools/BashTool/bashTool.js
var MAX_OUTPUT_LENGTH = 5e3;
var DEFAULT_TIMEOUT_SECONDS = 30;
var MAX_TIMEOUT_SECONDS = 120;
var HEALTH_CHECK_INTERVAL_MS = 1e4;
function formatOutput(content, maxLength = MAX_OUTPUT_LENGTH) {
  if (content.length <= maxLength) {
    return {
      totalLines: content.split("\n").length,
      truncatedContent: content
    };
  }
  const halfLength = maxLength / 2;
  const start = content.slice(0, halfLength);
  const end = content.slice(-halfLength);
  const truncatedChars = content.length - halfLength * 2;
  const truncated = `${start}

... [${truncatedChars} characters truncated] ...

${end}`;
  return {
    totalLines: content.split("\n").length,
    truncatedContent: truncated
  };
}
var inputSchema = external_exports.strictObject({
  command: external_exports.string().describe("The command to execute"),
  description: external_exports.string().optional().describe("One sentence explanation as to why this command needs to be run and how it contributes to the goal."),
  timeout: external_exports.number().int().min(0).max(MAX_TIMEOUT_SECONDS).optional().default(DEFAULT_TIMEOUT_SECONDS).describe("Timeout in seconds"),
  background: external_exports.boolean().optional().default(false).describe("Run in background. Returns PID and log file path immediately without waiting for completion."),
  maxOutputLength: external_exports.number().int().min(0).optional().default(MAX_OUTPUT_LENGTH).describe("Maximum amount of characters to return in the output.")
});