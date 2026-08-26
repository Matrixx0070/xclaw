/**
 * Connection-local busy_timeout helpers.
 * Temporary timeout around one synchronous call, then restore the previous value.
 */
const lockFailureReportingByDatabase = new WeakMap();

export function asNonNegInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

export function readBusyTimeout(database) {
  const row = database.prepare("PRAGMA busy_timeout").get();
  const value = row?.busy_timeout ?? row?.timeout;
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

export function setBusyTimeout(database, busyTimeoutMs) {
  const normalizedTimeoutMs = asNonNegInt(busyTimeoutMs, "busyTimeoutMs");
  database.exec(`PRAGMA busy_timeout = ${normalizedTimeoutMs}`);
}

export function shouldReportLockFailure(database) {
  return lockFailureReportingByDatabase.get(database) !== "suppress";
}

export function runWithBusyTimeout(database, busyTimeoutMs, operation, options = {}) {
  const normalizedTimeoutMs = asNonNegInt(busyTimeoutMs, "busyTimeoutMs");
  const previousBusyTimeoutMs = readBusyTimeout(database);
  const previousLockFailureReporting = lockFailureReportingByDatabase.get(database);
  if (options.lockFailureReporting) {
    lockFailureReportingByDatabase.set(database, options.lockFailureReporting);
  }
  if (previousBusyTimeoutMs !== normalizedTimeoutMs) {
    setBusyTimeout(database, normalizedTimeoutMs);
  }
  try {
    return operation();
  } finally {
    if (database.isOpen && previousBusyTimeoutMs !== normalizedTimeoutMs) {
      setBusyTimeout(database, previousBusyTimeoutMs);
    }
    if (previousLockFailureReporting) {
      lockFailureReportingByDatabase.set(database, previousLockFailureReporting);
    } else {
      lockFailureReportingByDatabase.delete(database);
    }
  }
}
