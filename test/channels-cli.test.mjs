import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Hermetic: redirect HOME so config writes land in a temp ~/.xclaw (channel
// config + secrets go to xclaw.json, not the auth-profile store).
const REAL_HOME = process.env.HOME;
const REAL_STATE = process.env.XCLAW_STATE_DIR;
let TMP;

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-chancli-"));
  process.env.HOME = TMP;
  process.env.XCLAW_STATE_DIR = path.join(TMP, ".xclaw");
  process.env.XCLAW_QUIET = "1";
});

afterEach(() => {
  process.exitCode = 0;
});

after(() => {
  process.env.HOME = REAL_HOME;
  if (REAL_STATE === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = REAL_STATE;
  fs.rmSync(TMP, { recursive: true, force: true });
});

const cfgPath = () => path.join(TMP, ".xclaw", "xclaw.json");
const readCfg = () => JSON.parse(fs.readFileSync(cfgPath(), "utf8"));

function capture() {
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  return { lines, restore() { console.log = orig.log; console.error = orig.error; } };
}

async function run(args) {
  const { runChannelsCli } = await import("../src/cli/channels-cli.mjs");
  const cap = capture();
  let code;
  try {
    code = await runChannelsCli(args);
  } finally {
    cap.restore();
  }
  return { code, out: cap.lines.join("\n") };
}

describe("channels CLI (non-interactive)", () => {
  it("set --field persists a channel field to config", async () => {
    const { code } = await run(["set", "--channel", "telegram", "--field", "token", "--value", "123:ABC"]);
    assert.equal(code, 0);
    assert.equal(readCfg().channels.telegram.token, "123:ABC");
  });

  it("secret set is not echoed back", async () => {
    const { out } = await run(["set", "--channel", "discord", "--field", "token", "--value", "supersecret"]);
    assert.ok(!out.includes("supersecret"), "token value must not be printed");
    assert.match(out, /secret/i);
    assert.equal(readCfg().channels.discord.token, "supersecret");
  });

  it("--clear nulls a field", async () => {
    await run(["set", "--channel", "telegram", "--field", "token", "--value", "x"]);
    const { code } = await run(["set", "--channel", "telegram", "--field", "token", "--clear"]);
    assert.equal(code, 0);
    assert.equal(readCfg().channels.telegram.token, null);
  });

  it("dot-path field (email.imap.host) nests correctly", async () => {
    await run(["set", "--channel", "email", "--field", "imap.host", "--value", "imap.example.com"]);
    assert.equal(readCfg().channels.email.imap.host, "imap.example.com");
  });

  it("list field coerces comma string to array", async () => {
    await run(["set", "--channel", "telegram", "--field", "allowedChatIds", "--value", "1, 2 ,3"]);
    assert.deepEqual(readCfg().channels.telegram.allowedChatIds, ["1", "2", "3"]);
  });

  it("enable / disable flip channels.<id>.enabled", async () => {
    await run(["enable", "slack"]);
    assert.equal(readCfg().channels.slack.enabled, true);
    await run(["disable", "slack"]);
    assert.equal(readCfg().channels.slack.enabled, false);
  });

  it("list renders without throwing", async () => {
    const { code, out } = await run(["list"]);
    assert.equal(code, 0);
    assert.match(out, /CHANNEL/);
    assert.match(out, /telegram/);
    assert.match(out, /webchat/);
  });

  it("unknown channel / field error with nonzero code", async () => {
    assert.equal((await run(["set", "--channel", "nope", "--field", "x", "--value", "y"])).code, 1);
    assert.equal((await run(["set", "--channel", "telegram", "--field", "bogus", "--value", "y"])).code, 1);
    assert.equal((await run(["enable", "nope"])).code, 1);
  });

  it("setup is guarded on non-TTY", async () => {
    const { code, out } = await run(["setup"]);
    assert.equal(code, 1);
    assert.match(out, /terminal/i);
  });

  it("help exits 0, unknown exits 1", async () => {
    assert.equal((await run(["help"])).code, 0);
    assert.equal((await run(["bogus"])).code, 1);
  });
});

describe("renderChannelTable (pure)", () => {
  it("groups enabled first and reports set fields without secret values", async () => {
    const { renderChannelTable } = await import("../src/cli/channels-cli.mjs");
    const inv = {
      channels: [
        { id: "telegram", name: "Telegram", enabled: true, configured: true, note: null,
          fields: [{ key: "token", secret: true, set: true }, { key: "transport", secret: false, set: true, value: "poll" }] },
        { id: "discord", name: "Discord", enabled: false, configured: false, note: null, fields: [] },
      ],
    };
    const lines = renderChannelTable(inv, { ansi: false }).join("\n");
    assert.match(lines, /telegram/);
    assert.match(lines, /token=set/);
    assert.match(lines, /transport=poll/);
    assert.match(lines, /— disabled —/);
    assert.ok(!lines.includes("supersecret"));
  });
});
