/**
 * Overlapping chat workspace roots must be reported.
 *
 * The sandbox roots itself at the per-chat workspace (loop.mjs guardToolPaths),
 * so it enforces "stay inside your workspace" correctly and cannot possibly
 * catch two chats POINTING AT THE SAME workspace: every path is inside both.
 * The one predicate that catches that — validateWorkspaceMap — was written,
 * tested, and wired to nothing, so the misconfiguration that defeats the whole
 * feature was the one the doctor could not report.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateWorkspaceMap,
  auditWorkspaceIsolation,
} from "../src/security/workspace-isolation.mjs";
import { chatWorkspaceMap, workspaceForChat } from "../src/channels/policy.mjs";
import { runSecurityAudit } from "../src/security/audit.mjs";

const ch = (channels) => ({ channels });
const detail = (r) => r.issues.map((i) => i.detail || i).join(" | ");

describe("the isolation reader reads what the runtime reads", () => {
  it("honours both key spellings, because workspaceForChat does", () => {
    // conf.workspaceByChatId || conf.workspaces — both resolve at runtime, so a
    // validator that checks only the first is blind to every config using the
    // second, and reports ok on a host with no isolation at all.
    for (const key of ["workspaceByChatId", "workspaces"]) {
      const cfg = ch({ telegram: { [key]: { "111": "/tmp/a", "222": "/tmp/b" } } });
      assert.deepEqual(chatWorkspaceMap(cfg, "telegram"), { "111": "/tmp/a", "222": "/tmp/b" }, key);
      assert.equal(workspaceForChat(cfg, "telegram", "222"), "/tmp/b", key);
      assert.equal(validateWorkspaceMap(cfg, "telegram").count, 2, key);
    }
  });

  it("has no opinion about a channel that binds nothing", () => {
    // No data is not a fault: an absent map means "no per-chat isolation was
    // configured", which is the default posture, not a misconfiguration.
    assert.equal(auditWorkspaceIsolation({}).ok, true);
    assert.equal(auditWorkspaceIsolation(ch({ telegram: { enabled: true } })).count, 0);
    assert.equal(auditWorkspaceIsolation(ch({ telegram: { workspaceByChatId: { a: "/tmp/x" } } })).ok, true);
  });
});

describe("overlapping workspace roots are found wherever they are configured", () => {
  it("flags two chats sharing one root", () => {
    const r = auditWorkspaceIsolation(ch({ telegram: { workspaceByChatId: { "111": "/tmp/w", "222": "/tmp/w" } } }));
    assert.equal(r.ok, false);
    assert.match(detail(r), /telegram:111/);
    assert.match(detail(r), /telegram:222/);
  });

  it("flags one root nested inside another", () => {
    const r = auditWorkspaceIsolation(ch({ slack: { workspaceByChatId: { C1: "/tmp/w", C2: "/tmp/w/sub" } } }));
    assert.equal(r.ok, false);
    assert.match(detail(r), /nested/i);
  });

  it("flags a map written with the alias key", () => {
    const r = auditWorkspaceIsolation(ch({ email: { workspaces: { "a@x": "/tmp/s", "b@x": "/tmp/s" } } }));
    assert.equal(r.ok, false);
    assert.match(detail(r), /email:a@x/);
  });

  it("flags an overlap that spans two channels", () => {
    // The isolation property is about distinct PEERS; peers live in different
    // channels too. A per-channel loop cannot see telegram and slack landing
    // on one root, which is the same breach as two chats on one root.
    const r = auditWorkspaceIsolation(
      ch({
        telegram: { workspaceByChatId: { "111": "/tmp/w" } },
        slack: { workspaceByChatId: { C1: "/tmp/w" } },
      })
    );
    assert.equal(r.ok, false);
    assert.match(detail(r), /telegram:111/);
    assert.match(detail(r), /slack:C1/);
  });

  it("does not mistake a shared name prefix for nesting", () => {
    // /tmp/w2 starts with /tmp/w. Comparing without the separator turns every
    // sibling whose name extends another's into a false breach report, and a
    // security row that cries wolf is one operators learn to skip.
    // Both orderings: the two roots are compared in one direction each, so a
    // separator dropped from either comparison is a false report the other
    // ordering cannot see.
    for (const map of [{ "111": "/tmp/w", "222": "/tmp/w2" }, { "111": "/tmp/w2", "222": "/tmp/w" }]) {
      const r = auditWorkspaceIsolation(ch({ telegram: { workspaceByChatId: map } }));
      assert.equal(r.ok, true, detail(r));
    }
  });

  it("compares roots as paths, not as the strings the operator typed", () => {
    // "/data/a/" and "/data/a" are one directory. Compared raw they are two,
    // so the trailing slash an operator adds by habit hides the breach.
    const r = auditWorkspaceIsolation(
      ch({ telegram: { workspaceByChatId: { "111": "/tmp/w/", "222": "/tmp/w/sub/..", "333": "/tmp/w" } } })
    );
    assert.equal(r.ok, false, "spellings of one root were treated as distinct roots");
    assert.equal(r.issues.length, 3, detail(r));
    for (const i of r.issues) assert.equal(i.kind, "shared", detail(r));
  });

  it("finds nesting whichever chat is listed first", () => {
    const parentFirst = auditWorkspaceIsolation(
      ch({ telegram: { workspaceByChatId: { p: "/tmp/w", c: "/tmp/w/sub" } } })
    );
    const childFirst = auditWorkspaceIsolation(
      ch({ telegram: { workspaceByChatId: { c: "/tmp/w/sub", p: "/tmp/w" } } })
    );
    assert.equal(parentFirst.ok, false);
    assert.equal(childFirst.ok, false, "nesting missed when the child is listed first");
    // Same breach, so both must name the child as the nested one.
    for (const r of [parentFirst, childFirst]) assert.match(detail(r), /telegram:c .*nested under telegram:p/);
  });

  it("ignores a binding that names no directory", () => {
    const r = auditWorkspaceIsolation(
      ch({ telegram: { workspaceByChatId: { a: "", b: null, c: "/tmp/w" } } })
    );
    assert.equal(r.ok, true, detail(r));
    assert.equal(r.count, 1, "an unset binding was counted as a bound workspace");
  });

  it("stays quiet when every root is distinct", () => {
    const r = auditWorkspaceIsolation(
      ch({
        telegram: { workspaceByChatId: { "111": "/tmp/a", "222": "/tmp/b" } },
        slack: { workspaceByChatId: { C1: "/tmp/c" } },
      })
    );
    assert.equal(r.ok, true, detail(r));
    assert.equal(r.count, 3);
  });
});

describe("the audit reports it", () => {
  const overlapping = ch({ telegram: { workspaceByChatId: { "111": "/tmp/w", "222": "/tmp/w" } } });

  it("raises a row an operator can act on", () => {
    const f = runSecurityAudit(overlapping).findings.find((x) => x.id === "workspace.isolation");
    assert.ok(f, "overlapping workspace roots went unreported");
    assert.match(f.message, /\/tmp\/w/);
    assert.ok(f.fix, "no remedy offered");
  });

  it("grades it the way this audit grades its other boundary faults", () => {
    const off = runSecurityAudit(overlapping).findings.find((x) => x.id === "workspace.isolation");
    assert.equal(off.level, "warn");
    const prod = runSecurityAudit({ ...overlapping, profile: "prod" }).findings.find(
      (x) => x.id === "workspace.isolation"
    );
    assert.equal(prod.level, "error");
    assert.equal(runSecurityAudit({ ...overlapping, profile: "prod" }).ok, false);
  });

  it("says so when isolation is configured and holds", () => {
    const cfg = ch({ telegram: { workspaceByChatId: { "111": "/tmp/a", "222": "/tmp/b" } } });
    const f = runSecurityAudit(cfg).findings.find((x) => x.id === "workspace.isolation");
    assert.equal(f?.level, "ok");
  });

  it("emits exactly one row however many overlaps there are", () => {
    // Two rows sharing an id is a shape that has already shipped here once.
    const cfg = ch({ telegram: { workspaceByChatId: { a: "/tmp/w", b: "/tmp/w", c: "/tmp/w" } } });
    const rows = runSecurityAudit(cfg).findings.filter((x) => x.id === "workspace.isolation");
    assert.equal(rows.length, 1);
    assert.match(rows[0].message, /3/);
  });
});
