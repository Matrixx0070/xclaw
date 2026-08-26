/**
 * Journal setup for long-lived xclaw SQL files.
 * Numbers and control flow match the hardened WAL maintenance used by
 * production agent gateways: 1000-page autocheckpoint, 30 minute PASSIVE
 * tick, 64 MiB journal cap, 512-page incremental vacuum, rollback on
 * NFS/CIFS/virtiofs/9p, refuse SSHFS, TRUNCATE on orderly close.
 */
import fs from "node:fs";
import path from "node:path";

export const WAL_AUTOCHECKPOINT_PAGES = 1000;
export const WAL_TICK_MS = 30 * 60 * 1000;
export const WAL_JOURNAL_CAP_BYTES = 64 * 1024 * 1024;
export const VACUUM_PAGES_PER_TICK = 512;
const LINUX_NFS = 0x6969;
const LINUX_SMB = 0x517b;
const LINUX_CIFS = 0xff534d42;
const LINUX_SMB2 = 0xfe534d42;
const LINUX_V9FS = 0x01021997;
const PROC_MOUNTINFO = "/proc/self/mountinfo";
const MOUNT_CMD_MS = 1000;
const NET_FS = new Set(["cifs", "smbfs", "smb2", "smb3"]);
const CROSS_VM_FS = new Set(["virtiofs", "fuse.virtiofs", "9p", "9p2000.l"]);
const MODE_RETRY_MS = 10;
const MODE_RETRY_SLOT = new Int32Array(new SharedArrayBuffer(4));
const PROC_FD = "/proc/self/fd";
const TIMER_CAP_MS = 2147483647;

export function asNonNegInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

export function isLockError(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  const errcode = error && typeof error === "object" ? error.errcode : undefined;
  if (typeof errcode !== "number") return false;
  const primary = errcode & 0xff;
  return primary === 5 || primary === 6;
}

function hasErrno(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}

function decodeMountInfoPath(raw) {
  return String(raw).replace(/\\([0-7]{3})/g, (_, oct) =>
    String.fromCharCode(Number.parseInt(oct, 8)),
  );
}

function setBusy(db, ms) {
  const n = asNonNegInt(ms, "busyTimeoutMs");
  db.exec(`PRAGMA busy_timeout = ${n};`);
  return n;
}

function enableIncrementalVacuumIfEmpty(db) {
  const row = db.prepare("PRAGMA page_count").get();
  if (row?.page_count === 0) db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
}

export function applyPreSchemaPragmas(db, { busyTimeoutMs } = {}) {
  if (busyTimeoutMs !== undefined) setBusy(db, busyTimeoutMs);
  enableIncrementalVacuumIfEmpty(db);
}

function findExistingVolumePaths(targetPath) {
  let current = path.resolve(targetPath);
  while (true) {
    let stats;
    try {
      stats = fs.statSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
      continue;
    }
    const existingPath = fs.realpathSync(current);
    return {
      canonicalPath: stats.isDirectory() ? existingPath : path.dirname(existingPath),
      originalPath: stats.isDirectory() ? current : path.dirname(current),
    };
  }
}

function parseProcMountInfoEntries(contents) {
  const entries = [];
  for (const line of contents.split("\n")) {
    const separator = line.indexOf(" - ");
    if (separator === -1) continue;
    const fields = line.slice(0, separator).split(" ");
    const suffixFields = line.slice(separator + 3).split(" ");
    const mountPoint = fields[4];
    const fsType = suffixFields[0];
    if (mountPoint && fsType) {
      entries.push({
        mountPoint: decodeMountInfoPath(mountPoint),
        fsType,
        ...(suffixFields[1] ? { source: decodeMountInfoPath(suffixFields[1]) } : {}),
      });
    }
  }
  return entries;
}

function parseMountCommandEntries(contents) {
  const entries = [];
  for (const line of contents.split("\n")) {
    const linuxMatch = /^(.+) on (.+) type ([^,\s)]+) \(/.exec(line);
    if (linuxMatch) {
      entries.push({ source: linuxMatch[1], mountPoint: linuxMatch[2], fsType: linuxMatch[3] });
      continue;
    }
    const bsdMatch = /^(.+) on (.+) \(([^,\s)]+)/.exec(line);
    if (bsdMatch) {
      entries.push({ source: bsdMatch[1], mountPoint: bsdMatch[2], fsType: bsdMatch[3] });
    }
  }
  return entries;
}

function readMountEntries() {
  try {
    return { ok: true, value: parseProcMountInfoEntries(fs.readFileSync(PROC_MOUNTINFO, "utf8")) };
  } catch {
    /* macOS / BSD */
  }
  try {
    const out = process.getBuiltinModule("node:child_process").execFileSync("mount", [], {
      killSignal: "SIGKILL",
      timeout: MOUNT_CMD_MS,
    });
    return { ok: true, value: parseMountCommandEntries(String(out)) };
  } catch (error) {
    const timedOut = error && typeof error === "object" && error.code === "ETIMEDOUT";
    return timedOut ? { ok: false, error: "timeout" } : { ok: true, value: [] };
  }
}

function isPathWithinMount(targetPath, mountPoint) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedMountPoint = path.resolve(mountPoint);
  return (
    resolvedTarget === resolvedMountPoint ||
    resolvedMountPoint === path.parse(resolvedMountPoint).root ||
    resolvedTarget.startsWith(`${resolvedMountPoint}${path.sep}`)
  );
}

function isSshfsMountSource(source) {
  if (!source) return false;
  const normalized = source.toLowerCase();
  return (
    normalized === "sshfs" ||
    normalized.startsWith("sshfs#") ||
    normalized.startsWith("sshfs@") ||
    /^(?:[^/\s:]+@)?[^/\s:]+:.*/u.test(source)
  );
}

function resolveMountTypeJournalPolicy(entry) {
  const normalized = entry.fsType.toLowerCase();
  if (normalized.startsWith("nfs") || NET_FS.has(normalized)) return "rollback";
  if (CROSS_VM_FS.has(normalized) || normalized.startsWith("9p")) return "rollback";
  if (normalized === "fuse.sshfs") return "unsupported";
  if ((normalized === "macfuse" || normalized === "osxfuse") && isSshfsMountSource(entry.source)) {
    return "unsupported";
  }
  return "wal";
}

function resolveMountEntryJournalPolicy(targetPath, mountEntries) {
  const mountEntry = mountEntries
    .filter((entry) => isPathWithinMount(targetPath, entry.mountPoint))
    .toSorted((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
  return mountEntry ? resolveMountTypeJournalPolicy(mountEntry) : "wal";
}

function combineMountEntryJournalPolicies(targetPaths) {
  const mountResult = readMountEntries();
  if (!mountResult.ok) return "rollback";
  const policies = new Set(
    targetPaths.map((targetPath) => resolveMountEntryJournalPolicy(targetPath, mountResult.value)),
  );
  if (policies.has("unsupported")) return "unsupported";
  return policies.has("rollback") ? "rollback" : "wal";
}

function isWindowsUncPath(targetPath) {
  return (
    /^\\\\\?\\UNC\\[^\\]+\\[^\\]+/i.test(targetPath) ||
    /^\\\\(?![?.]\\)[^\\]+\\[^\\]+/.test(targetPath)
  );
}

function isWindowsDrivePath(targetPath) {
  return /^[A-Za-z]:[\\/]/.test(targetPath) || /^\\\\\?\\[A-Za-z]:[\\/]/i.test(targetPath);
}

export function resolvePathJournalPolicy(targetPath) {
  if (process.platform === "win32") {
    const normalizedTargetPath = path.win32.normalize(targetPath);
    if (isWindowsUncPath(normalizedTargetPath)) return "rollback";
    if (isWindowsDrivePath(normalizedTargetPath)) {
      try {
        return isWindowsUncPath(path.win32.normalize(fs.realpathSync.native(targetPath)))
          ? "rollback"
          : "wal";
      } catch {
        return "rollback";
      }
    }
  }
  const checkedPaths = findExistingVolumePaths(targetPath);
  if (!checkedPaths) return "wal";
  const mountLookupPaths = [checkedPaths.originalPath, checkedPaths.canonicalPath];
  if (typeof fs.statfsSync !== "function") {
    return combineMountEntryJournalPolicies(mountLookupPaths);
  }
  try {
    const filesystemType = fs.statfsSync(checkedPaths.canonicalPath).type;
    if (
      filesystemType === LINUX_NFS ||
      filesystemType === LINUX_SMB ||
      filesystemType === LINUX_CIFS ||
      filesystemType === LINUX_SMB2 ||
      filesystemType === LINUX_V9FS
    ) {
      return "rollback";
    }
  } catch {
    return combineMountEntryJournalPolicies(mountLookupPaths);
  }
  return combineMountEntryJournalPolicies(mountLookupPaths);
}

function readJournalModeResult(row) {
  if (!row || typeof row !== "object") return null;
  const value = row.journal_mode ?? Object.values(row)[0];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function hasInMemoryMainDatabase(db) {
  const rows = db.prepare("PRAGMA database_list;").all();
  const main = rows.find((row) => row.name === "main");
  return main?.file === "";
}

function readCheckpointBusyResult(row) {
  if (!row || typeof row !== "object") return false;
  const value = row.busy ?? Object.values(row)[0];
  return value === 1 || value === 1n;
}

function statSidecar(pathname) {
  try {
    return fs.statSync(pathname, { bigint: true });
  } catch (error) {
    if (hasErrno(error, "ENOENT")) return undefined;
    throw error;
  }
}

function isSidecarSplit(descriptor, target) {
  return (
    descriptor.nlink === 0n ||
    !target ||
    descriptor.dev !== target.dev ||
    descriptor.ino !== target.ino
  );
}

function detectWalSplitBrain(databasePath) {
  let descriptors;
  try {
    descriptors = fs.readdirSync(PROC_FD);
  } catch (error) {
    if (hasErrno(error, "ENOENT")) return undefined;
    throw error;
  }
  const sidecarPaths = [`${databasePath}-wal`, `${databasePath}-shm`];
  for (const descriptorName of descriptors) {
    const descriptorPath = path.join(PROC_FD, descriptorName);
    let linkedPath;
    try {
      linkedPath = fs.readlinkSync(descriptorPath);
    } catch (error) {
      if (hasErrno(error, "ENOENT")) continue;
      throw error;
    }
    const sidecarPath = sidecarPaths.find(
      (candidate) => linkedPath === candidate || linkedPath === `${candidate} (deleted)`,
    );
    if (!sidecarPath) continue;
    let descriptor;
    try {
      descriptor = fs.fstatSync(Number(descriptorName), { bigint: true });
    } catch (error) {
      if (hasErrno(error, "EBADF") || hasErrno(error, "ENOENT")) continue;
      throw error;
    }
    try {
      if (fs.readlinkSync(descriptorPath) !== linkedPath) continue;
    } catch (error) {
      if (hasErrno(error, "ENOENT")) continue;
      throw error;
    }
    const target = statSidecar(sidecarPath);
    if (!isSidecarSplit(descriptor, target)) continue;
    return {
      event: "wal_sidecar_identity_mismatch",
      databasePath,
      descriptorDevice: descriptor.dev.toString(),
      descriptorInode: descriptor.ino.toString(),
      sidecarPath,
      ...(target
        ? { targetDevice: target.dev.toString(), targetInode: target.ino.toString() }
        : {}),
    };
  }
  return undefined;
}

function requireRollbackJournalMode(db, options) {
  const row = db.prepare("PRAGMA journal_mode = DELETE;").get();
  const journalMode = readJournalModeResult(row);
  if (journalMode !== "delete") {
    const label = options.databaseLabel ?? "sql file";
    const location = options.databasePath ? ` at ${options.databasePath}` : "";
    throw new Error(
      `${label}${location} sits on a network volume but journal_mode stayed ${journalMode ?? "unknown"}; refusing WAL there.`,
    );
  }
}

function enableWalJournalMode(db, retryTimeoutMs, options) {
  const deadline = Date.now() + retryTimeoutMs;
  let restoreBusyTimeout = false;
  try {
    while (true) {
      try {
        db.exec("PRAGMA journal_mode = WAL;");
        const journalMode = readJournalModeResult(db.prepare("PRAGMA journal_mode;").get());
        if (journalMode === "wal") return true;
        if (journalMode === "memory" && hasInMemoryMainDatabase(db)) return false;
        const label = options.databaseLabel ?? "sql file";
        const location = options.databasePath ? ` at ${options.databasePath}` : "";
        throw new Error(
          `${label}${location} could not enable WAL; journal_mode=${journalMode ?? "unknown"}.`,
        );
      } catch (error) {
        const remainingMs = deadline - Date.now();
        if (!isLockError(error) || remainingMs <= 0) throw error;
        if (!restoreBusyTimeout) {
          setBusy(db, 0);
          restoreBusyTimeout = true;
        }
        Atomics.wait(MODE_RETRY_SLOT, 0, 0, Math.min(MODE_RETRY_MS, remainingMs));
      }
    }
  } finally {
    if (restoreBusyTimeout) setBusy(db, retryTimeoutMs);
  }
}

function enableMacosCheckpointFullfsync(db) {
  if (process.platform !== "darwin") return;
  try {
    db.exec("PRAGMA checkpoint_fullfsync = 1;");
  } catch {
    /* older builds */
  }
}

export function attachJournalKeeper(db, options = {}) {
  const busyTimeoutMs =
    options.busyTimeoutMs === undefined ? 0 : setBusy(db, options.busyTimeoutMs);
  const autoCheckpointPages = asNonNegInt(
    options.autoCheckpointPages ?? WAL_AUTOCHECKPOINT_PAGES,
    "autoCheckpointPages",
  );
  const checkpointIntervalMs = asNonNegInt(
    options.checkpointIntervalMs ?? WAL_TICK_MS,
    "checkpointIntervalMs",
  );
  const timerIntervalMs = Math.min(checkpointIntervalMs, TIMER_CAP_MS);
  const checkpointMode = options.checkpointMode ?? "TRUNCATE";
  const periodicCheckpointMode = options.checkpointMode ?? "PASSIVE";
  const journalPolicy = options.databasePath
    ? resolvePathJournalPolicy(options.databasePath)
    : "wal";
  if (journalPolicy === "unsupported") {
    const label = options.databaseLabel ?? "sql file";
    const location = options.databasePath ? ` at ${options.databasePath}` : "";
    throw new Error(
      `${label}${location} is on SSHFS; refusing to open (no safe write coordination across mounts).`,
    );
  }
  if (journalPolicy === "rollback") {
    requireRollbackJournalMode(db, options);
    return { checkpoint: () => true, detach: () => true, close: () => true };
  }
  if (!enableWalJournalMode(db, busyTimeoutMs, options)) {
    return { checkpoint: () => true, detach: () => true, close: () => true };
  }
  enableMacosCheckpointFullfsync(db);
  db.exec(`PRAGMA wal_autocheckpoint = ${autoCheckpointPages};`);
  db.exec(`PRAGMA journal_size_limit = ${WAL_JOURNAL_CAP_BYTES};`);
  const tripwireDatabasePath =
    process.platform === "linux" && options.databasePath && fs.existsSync(options.databasePath)
      ? fs.realpathSync.native(options.databasePath)
      : undefined;
  let invalidated = false;
  let splitBrainDetectionEnabled = Boolean(tripwireDatabasePath);

  const runCheckpoint = (mode) => {
    try {
      const row = db.prepare(`PRAGMA wal_checkpoint(${mode});`).get();
      if (readCheckpointBusyResult(row)) {
        const error = new Error(
          `${options.databaseLabel ?? "sql file"} WAL checkpoint ${mode} remained busy`,
        );
        options.onCheckpointError?.(error);
        return false;
      }
      return true;
    } catch (error) {
      options.onCheckpointError?.(error);
      return false;
    }
  };

  const runIncrementalVacuum = () => {
    try {
      db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES_PER_TICK});`);
    } catch (error) {
      options.onCheckpointError?.(error);
    }
  };

  let timer = null;
  if (timerIntervalMs > 0) {
    timer = setInterval(() => {
      if (tripwireDatabasePath && splitBrainDetectionEnabled) {
        try {
          const splitBrain = detectWalSplitBrain(tripwireDatabasePath);
          if (splitBrain) {
            invalidated = true;
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
            console.error("[xclaw:sql] wal sidecar identity mismatch", splitBrain);
            try {
              options.onWalSplitBrain?.(splitBrain);
            } catch (error) {
              console.error("[xclaw:sql] split-brain hook failed", error?.message || error);
            }
            try {
              if (db.isOpen) db.close();
            } catch (error) {
              console.error("[xclaw:sql] split-brain close failed", error?.message || error);
            }
            return;
          }
        } catch (error) {
          splitBrainDetectionEnabled = false;
          console.warn("[xclaw:sql] split-brain detection disabled", error?.message || error);
        }
      }
      runCheckpoint(periodicCheckpointMode);
      runIncrementalVacuum();
    }, timerIntervalMs);
    timer.unref?.();
  }

  const close = (closeOptions) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (invalidated) return false;
    return runCheckpoint(closeOptions?.checkpointMode ?? checkpointMode);
  };

  return {
    checkpoint: () => !invalidated && runCheckpoint(checkpointMode),
    detach: () => close({ checkpointMode: "TRUNCATE" }),
    close,
  };
}

export function applyStorePragmas(db, options = {}) {
  applyPreSchemaPragmas(db, options);
  const keeper = attachJournalKeeper(db, options);
  if (options.synchronous) db.exec(`PRAGMA synchronous = ${options.synchronous};`);
  else db.exec("PRAGMA synchronous = NORMAL;");
  if (options.foreignKeys) db.exec("PRAGMA foreign_keys = ON;");
  return keeper;
}

export function registerExitClose(closeAll) {
  const closeOnExit = () => {
    try {
      closeAll();
    } catch {
      /* best-effort */
    }
  };
  process.once("exit", closeOnExit);
  return () => process.removeListener("exit", closeOnExit);
}
