import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditRow,
  auditRowId,
  auditRowStatus,
  auditRowMessage,
} from "../src/cli/doctor-audit-row.mjs";
import { runSecurityAudit } from "../src/security/audit.mjs";

// The doctor translated every runSecurityAudit finding into a row with three
// inline lines in runDoctor, and shipped `security.security.autoApprove` on the
// live host for as long as the audit has existed. See doctor-audit-row.mjs for
// the three defects; these pin each one, plus the wiring, which cannot be
// exercised (runDoctor loads real config and makes live HTTP requests).
const DOCTOR = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "doctor.mjs"),
  "utf8"
);

describe("doctor audit-row translation", () => {
  it("does not double a prefix the audit already carries", () => {
    // The exact live row: `security.security.autoApprove`.
    assert.equal(auditRowId("security.autoApprove"), "security.autoApprove");
    assert.equal(auditRowId("security.systemRunPlan"), "security.systemRunPlan");
    assert.equal(auditRowId("security.requirePinnedExe"), "security.requirePinnedExe");
  });

  it("still groups the ids that do not carry it", () => {
    assert.equal(auditRowId("gateway.bind"), "security.gateway.bind");
    assert.equal(auditRowId("apiKey"), "security.apiKey");
    assert.equal(auditRowId("channels.telegram.dm"), "security.channels.telegram.dm");
  });

  it("names a finding with no id rather than emitting a bare prefix", () => {
    assert.equal(auditRowId(""), "security.audit");
    assert.equal(auditRowId(undefined), "security.audit");
  });

  it("reports info as info, not as ok", () => {
    // The dead if/else: `if (level === "ok") push(ok) else push(ok)`. A
    // localhost host with no gateway token got a green row saying it has none.
    assert.equal(auditRowStatus("info"), "info");
  });

  it("passes every level the doctor renders through unchanged", () => {
    assert.equal(auditRowStatus("ok"), "ok");
    assert.equal(auditRowStatus("warn"), "warn");
    assert.equal(auditRowStatus("error"), "error");
  });

  it("surfaces an unrenderable level as an error instead of hiding it", () => {
    assert.equal(auditRowStatus("critical"), "error");
    assert.equal(auditRowStatus(undefined), "error");
  });

  it("carries the remedy at every level that has one, info included", () => {
    assert.equal(
      auditRowMessage({ message: "No XCLAW_GATEWAY_TOKEN", fix: "Export it" }),
      "No XCLAW_GATEWAY_TOKEN — Export it"
    );
    assert.equal(auditRowMessage({ message: "autoApprove off" }), "autoApprove off");
    assert.deepEqual(
      auditRow({ id: "gateway.token", level: "info", message: "none", fix: "Export it" }),
      { id: "security.gateway.token", status: "info", message: "none — Export it" }
    );
  });

  it("translates a real audit with no id colliding and no doubled prefix", () => {
    const audit = runSecurityAudit({
      gateway: { host: "127.0.0.1" },
      security: { autoApprove: true, requirePinnedExe: true },
      agent: { apiKey: "x" },
    });
    const rows = audit.findings.map(auditRow);
    assert.ok(rows.length >= 5, `expected findings, got ${rows.length}`);
    for (const r of rows) {
      assert.ok(!r.id.includes("security.security."), `doubled prefix: ${r.id}`);
      assert.ok(r.id.startsWith("security."), `ungrouped row: ${r.id}`);
    }
    const ids = rows.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate row ids: ${ids.join(", ")}`);
    assert.ok(ids.includes("security.autoApprove"), ids.join(", "));
  });
});

describe("doctor audit-row wiring", () => {
  it("runDoctor builds security rows through the translator", () => {
    assert.ok(
      /import \{[^}]*auditRow[^}]*\} from "\.\/doctor-audit-row\.mjs"/.test(DOCTOR),
      "doctor.mjs must import the translator"
    );
    assert.ok(
      /auditRow\(f\)/.test(DOCTOR),
      "doctor.mjs must translate each finding through auditRow"
    );
  });

  it("no longer builds a security row id by raw interpolation", () => {
    // `push(\`security.${f.id}\`, ...)` is what produced the doubled prefix.
    assert.ok(
      !/push\(`security\.\$\{/.test(DOCTOR),
      "doctor.mjs still interpolates the security prefix inline"
    );
  });

  it("leaves security.autoApprove to the audit, with no inline duplicate", () => {
    // Two rows for one setting — `security.autoApprove` (inline, no remedy) and
    // `security.security.autoApprove` (audit, with remedy) — were both live.
    // Removing the inline push is what makes de-doubling safe: without it the
    // two collapse onto the same id and the report contradicts itself.
    assert.ok(
      !/push\("security\.autoApprove"/.test(DOCTOR),
      "doctor.mjs still pushes its own security.autoApprove row"
    );
  });
});
