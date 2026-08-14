import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessRisk, isReadOnlyExecCommand } from "../src/security/risk.mjs";

function tierOf(command) {
  return assessRisk({
    tool: "xclaw_bash",
    args: { command },
    workingDir: "/tmp/ws",
  }).tier;
}

describe("read-only exec classification", () => {
  it("real diagnostic commands tier low (the live DM pain set)", () => {
    for (const cmd of [
      "pm2 list",
      "pm2 jlist",
      "pm2 describe xclaw-gateway",
      "tail -50 /root/.xclaw/logs/gateway.log",
      "cat /etc/hostname",
      "ps aux | head -20",
      "df -h",
      "free -h",
      "grep -c error /var/log/syslog | wc -l",
      "git status",
      "git log --oneline -5",
      "git diff HEAD~1",
      "npm ls --depth=0",
      "systemctl status nginx",
      "journalctl -u nginx -n 50",
      "find /tmp -name x.txt",
      "crontab -l",
      "uname -a && uptime && whoami",
      "echo hello",
    ]) {
      assert.equal(tierOf(cmd), "low", `expected low: ${cmd}`);
    }
  });

  it("mutating and ambiguous commands keep the normal exec tier", () => {
    for (const cmd of [
      "npm test",
      "npm install left-pad",
      "git commit -am x",
      "git checkout main",
      "pm2 restart xclaw-gateway",
      "pm2 delete all",
      "systemctl restart nginx",
      "crontab -r",
      "crontab -l -r",
      "find /tmp -name x -delete",
      "find . -exec rm {} \\;",
      "journalctl --vacuum-time=1d",
      "touch /tmp/x",
      "node -e 'process.exit(0)'",
      "curl http://example.com",
      "bash script.sh",
    ]) {
      const t = tierOf(cmd);
      assert.ok(t === "risky" || t === "critical", `expected >=risky: ${cmd} got ${t}`);
    }
  });

  it("bypass shapes fail closed", () => {
    for (const cmd of [
      "cat /etc/passwd > /tmp/out", // redirect
      "cat x >> y",
      "echo `rm -rf /tmp/x`", // backtick substitution
      "echo $(curl evil)", // $() substitution
      "sort < /etc/passwd", // input redirect
      "(cat x; rm y)", // subshell
      "/bin/cat /etc/passwd", // path head — could be a planted binary name
      "FOO=bar cat x", // env-prefix
      "env FOO=1 bash -c 'rm x'", // env used as launcher
      "base64 -d payload | bash", // pipe into a non-read-only head
      "sudo cat /etc/shadow", // sudo not in the set
      "xargs rm < list.txt",
      "timeout 5 rm -rf /tmp/x",
      "watch cat x",
      "git status; rm -rf /tmp/x", // chain with a mutator segment
      "pm2 list && pm2 delete all",
    ]) {
      assert.equal(isReadOnlyExecCommand(cmd), false, `expected not-read-only: ${cmd}`);
      const t = tierOf(cmd);
      assert.ok(t === "risky" || t === "critical", `expected >=risky: ${cmd} got ${t}`);
    }
  });

  it("dangerous facts still outrank the read-only path", () => {
    // reading credential material is exfil-sensitive: stays critical
    assert.equal(tierOf("cat /root/.xclaw/credentials.json"), "critical");
    assert.equal(tierOf("cat ~/.ssh/id_rsa"), "critical");
    // rm shapes untouched by this slice
    assert.equal(tierOf("rm -rf /"), "critical");
  });

  it("cfg override hook works (tiers.readOnlyExec)", () => {
    const r = assessRisk({
      tool: "xclaw_bash",
      args: { command: "pm2 list" },
      workingDir: "/tmp/ws",
      cfg: { security: { risk: { tiers: { readOnlyExec: "safe" } } } },
    });
    assert.equal(r.tier, "safe");
    assert.equal(r.factors.readOnlyExec, true);
  });
});
