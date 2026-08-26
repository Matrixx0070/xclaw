/**
 * Swallow only the builtin SQLite ExperimentalWarning so operator logs
 * stay clean. Do not swallow other warnings.
 *
 * Armed once from loadBuiltinSql() before require("node:sqlite").
 * Adding any 'warning' listener disables Node's default stderr printer,
 * so this module snapshots existing listeners, replaces the chain, and
 * prints non-sqlite warnings itself when nobody else is listening.
 */
let armed = false;

function isSqliteExperimental(w) {
  const name = w?.name || "";
  const msg = String(w?.message || "");
  return name === "ExperimentalWarning" && /sqlite/i.test(msg);
}

function printWarning(w) {
  const name = w?.name || "Warning";
  const msg = String(w?.message || "");
  const code = w?.code ? ` [${w.code}]` : "";
  process.stderr.write(`(${name}) ${msg}${code}\n`);
}

export function armSqlNoticeFilter() {
  if (armed) return;
  armed = true;
  const prev = process.listeners("warning").slice();
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (isSqliteExperimental(w)) return;
    if (prev.length === 0) {
      printWarning(w);
      return;
    }
    for (const fn of prev) {
      try {
        fn(w);
      } catch {
        /* keep remaining listeners */
      }
    }
  });
}

/** Test-only: whether the filter has been installed in this process. */
export function sqlNoticeFilterArmed() {
  return armed;
}
