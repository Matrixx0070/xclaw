import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Hermetic: redirect HOME (os.homedir() reads $HOME dynamically on POSIX) and
// the profile store so nothing touches the real ~/.xclaw.
const REAL_HOME = process.env.HOME;
const REAL_STATE = process.env.XCLAW_STATE_DIR;
let TMP;

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-provcli-"));
  process.env.HOME = TMP;
  process.env.XCLAW_STATE_DIR = path.join(TMP, ".xclaw");
  process.env.XCLAW_QUIET = "1";
  process.env.XCLAW_NO_LIVE_MODELS = "1"; // never hit provider endpoints from tests
});

// runProvidersCli sets process.exitCode for the shell; a failure-path test
// would otherwise mark this whole file failed.
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

function captureConsole() {
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  return {
    lines,
    restore() {
      console.log = orig.log;
      console.error = orig.error;
    },
  };
}

describe("providers CLI (non-interactive paths)", () => {
  it("set --base-url persists a per-provider endpoint to config", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    let code;
    try {
      code = await runProvidersCli(["set", "--provider", "ollama", "--base-url", "http://10.0.0.5:11434/v1/"]);
    } finally {
      cap.restore();
    }
    assert.equal(code, 0);
    const cfg = readCfg();
    // trailing slash stripped by setProviderBaseUrl
    assert.equal(cfg.providers.ollama.baseUrl, "http://10.0.0.5:11434/v1");
  });

  it("set --reset-url clears the custom endpoint", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    let code;
    try {
      code = await runProvidersCli(["set", "--provider", "ollama", "--reset-url"]);
    } finally {
      cap.restore();
    }
    assert.equal(code, 0);
    assert.equal(readCfg().providers.ollama.baseUrl, null);
  });

  it("set with unknown provider fails", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    let code;
    try {
      code = await runProvidersCli(["set", "--provider", "nope", "--base-url", "http://x/v1"]);
    } finally {
      cap.restore();
    }
    assert.equal(code, 1);
    assert.match(cap.lines.join("\n"), /Unknown provider/);
  });

  it("set with no action flags fails with usage", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    let code;
    try {
      code = await runProvidersCli(["set", "--provider", "ollama"]);
    } finally {
      cap.restore();
    }
    assert.equal(code, 1);
    assert.match(cap.lines.join("\n"), /Nothing to set/);
  });

  it("use X model writes agent.provider/model and clears agent.baseUrl", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    let code;
    try {
      code = await runProvidersCli(["use", "ollama", "llama3.3"]);
    } finally {
      cap.restore();
    }
    assert.equal(code, 0);
    const cfg = readCfg();
    assert.equal(cfg.agent.provider, "ollama");
    assert.equal(cfg.agent.model, "llama3.3");
    assert.equal(cfg.agent.baseUrl, null);
  });

  it("use X without model falls to THAT provider's default (no stale leak)", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    try {
      await runProvidersCli(["use", "deepseek"]);
    } finally {
      cap.restore();
    }
    const cfg = readCfg();
    assert.equal(cfg.agent.provider, "deepseek");
    assert.equal(cfg.agent.model, "deepseek-chat"); // deepseek's default, not llama3.3
  });

  it("use with unknown provider fails", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    let code;
    try {
      code = await runProvidersCli(["use", "nope", "m"]);
    } finally {
      cap.restore();
    }
    assert.equal(code, 1);
  });

  it("list renders the table without throwing (marks active + custom URL)", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    await runProvidersCli(["set", "--provider", "groq", "--base-url", "http://groq.local/v1"]);
    const cap = captureConsole();
    let code;
    try {
      code = await runProvidersCli(["list"]);
    } finally {
      cap.restore();
    }
    assert.equal(code, 0);
    const out = cap.lines.join("\n");
    assert.match(out, /deepseek/);
    assert.match(out, /groq\.local\/v1 \[custom\]/);
    assert.match(out, /ollama/);
  });

  it("renderProviderTable is pure and ANSI-optional", async () => {
    const { renderProviderTable } = await import("../src/cli/providers-cli.mjs");
    const lines = renderProviderTable(
      {
        active: { provider: "ollama", model: "llama3.3" },
        providers: [
          {
            id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1",
            baseUrlCustom: false, hasKey: false, hasOAuth: false, oauthExpired: false,
            configured: true, isActive: true, defaultModel: "llama3.3", models: [],
          },
        ],
      },
      { ansi: false }
    );
    assert.ok(lines.some((l) => l.includes("ollama") && l.includes("llama3.3")));
    assert.ok(!lines.join("").includes("\x1b["));
  });

  it("interactive subcommands detect non-TTY and return cleanly", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    for (const argv of [["use"], ["setup"], ["oauth", "--provider", "anthropic"]]) {
      const cap = captureConsole();
      let code;
      try {
        code = await runProvidersCli(argv);
      } finally {
        cap.restore();
      }
      assert.equal(code, 1, `${argv.join(" ")} should fail fast without TTY`);
      assert.match(cap.lines.join("\n"), /interactive terminal/i, argv.join(" "));
    }
  });

  it("api key stores under <provider>:apikey and becomes the preferred profile", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const { listProfiles, loginOAuthTokens, getAuthOrder } = await import("../src/auth/profiles.mjs");
    const { loadConfig } = await import("../src/config/load.mjs");
    const cfg = await loadConfig();
    // Pre-store an OAuth profile, then add an api key via the CLI — both must coexist.
    await loginOAuthTokens(cfg, { provider: "groq", name: "oauth", accessToken: "oat-1" });
    const cap = captureConsole();
    try {
      const code = await runProvidersCli(["set", "--provider", "groq", "--api-key", "gsk-test-123"]);
      assert.equal(code, 0);
    } finally {
      cap.restore();
    }
    const profiles = await listProfiles(cfg, "groq");
    const ids = profiles.map((p) => p.id).sort();
    assert.deepEqual(ids, ["groq:apikey", "groq:oauth"], "both credential kinds must coexist");
    const order = await getAuthOrder(cfg, "groq");
    const first = Array.isArray(order) ? order[0] : order?.order?.[0] || order?.ids?.[0];
    assert.equal(first, "groq:apikey", "freshly stored key must be preferred");
  });

  it("help prints usage with exit 0; unknown subcommand exits 1", async () => {
    const { runProvidersCli } = await import("../src/cli/providers-cli.mjs");
    const cap = captureConsole();
    let ok, bad;
    try {
      ok = await runProvidersCli(["help"]);
      bad = await runProvidersCli(["bogus"]);
    } finally {
      cap.restore();
    }
    assert.equal(ok, 0);
    assert.equal(bad, 1);
    assert.match(cap.lines.join("\n"), /providers setup/);
  });
});
