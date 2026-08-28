/**
 * xclaw auth — three ways to use Grok models:
 *   1) API key
 *   2) OAuth / CLI
 *   3) Web login (grok.com session import)
 */
import {
  loginXai,
  logoutXai,
  authStatus,
  importGrokCliAuth,
} from "../auth/xai-oauth.mjs";
import {
  webLoginInstructions,
  importWebSession,
  importWebSessionFile,
  clearWebSession,
} from "../auth/web-login.mjs";
import { listGrokAuthModes } from "../auth/modes.mjs";
import {
  evaluateRotation,
  rotateWebSession,
  bindAfterImport,
  listRotationStrategies,
  gateWebSession,
} from "../auth/cookie-rotation.mjs";
import {
  rotateFingerprint,
  verifyFingerprint,
  ensureFingerprintBinding,
  fingerprintStatus,
  gateWithFingerprint,
} from "../auth/fingerprint-rotation.mjs";
import {
  createRegistrationOptions,
  createAssertionOptions,
  webauthnStatus,
  gateWithWebAuthn,
  markWebAuthnRequiredAfterRotate,
  webauthnBrowserSnippet,
} from "../auth/webauthn.mjs";

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function runAuthCli(cfg, argv = []) {
  const [cmd, ...args] = argv;
  const sub = cmd || "status";

  if (sub === "status") {
    const s = await authStatus(cfg);
    console.log(JSON.stringify(s, null, 2));
    return s.loggedIn ? 0 : 1;
  }

  if (sub === "modes") {
    console.log(JSON.stringify(listGrokAuthModes(), null, 2));
    return 0;
  }

  if (sub === "logout") {
    await logoutXai(cfg);
    await clearWebSession(cfg);
    console.log("Logged out (OAuth tokens + web session cleared)");
    return 0;
  }

  if (sub === "web-import") {
    const file = flag(args, "--file");
    const cookie = flag(args, "--cookie");
    const token = flag(args, "--token");
    let r;
    if (file) r = await importWebSessionFile(cfg, file);
    else
      r = await importWebSession(cfg, {
        cookie,
        token,
        authorization: token ? `Bearer ${token}` : undefined,
      });
    if (r.ok) {
      const bound = await bindAfterImport(cfg);
      r.rotation = bound;
    }
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  if (sub === "rotate") {
    const r = await rotateWebSession(cfg, { keepPrevious: true });
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  if (sub === "rotation") {
    if ((args[0] || "") === "strategies") {
      console.log(JSON.stringify(listRotationStrategies(), null, 2));
      return 0;
    }
    const ev = await evaluateRotation(cfg);
    console.log(JSON.stringify(ev, null, 2));
    return ev.ok ? 0 : 1;
  }

  if (sub === "gate") {
    const g = await gateWithFingerprint(cfg);
    console.log(JSON.stringify(g, null, 2));
    return g.allowed ? 0 : 1;
  }

  if (sub === "fingerprint") {
    const action = args[0] || "status";
    if (action === "status") {
      console.log(JSON.stringify(await fingerprintStatus(cfg), null, 2));
      return 0;
    }
    if (action === "bind") {
      const r = await ensureFingerprintBinding(cfg);
      console.log(JSON.stringify(r, null, 2));
      return r.ok ? 0 : 1;
    }
    if (action === "verify") {
      const r = await verifyFingerprint(cfg);
      console.log(JSON.stringify(r, null, 2));
      return r.ok ? 0 : 1;
    }
    if (action === "rotate") {
      const mode = flag(args, "--mode") || "both";
      const r = await rotateFingerprint(cfg, { mode });
      if (r.ok) {
        await markWebAuthnRequiredAfterRotate(cfg).catch(() => {});
      }
      console.log(JSON.stringify(r, null, 2));
      return r.ok ? 0 : 1;
    }
    console.error(
      "Usage: xclaw auth fingerprint <status|bind|verify|rotate [--mode salt|generation|both]>"
    );
    return 1;
  }

  if (sub === "webauthn") {
    const action = args[0] || "status";
    if (action === "status") {
      console.log(JSON.stringify(await webauthnStatus(cfg), null, 2));
      return 0;
    }
    if (action === "register-options") {
      console.log(JSON.stringify(await createRegistrationOptions(cfg), null, 2));
      return 0;
    }
    if (action === "assert-options") {
      const r = await createAssertionOptions(cfg);
      console.log(JSON.stringify(r, null, 2));
      return r.ok === false ? 1 : 0;
    }
    if (action === "gate") {
      const r = await gateWithWebAuthn(cfg);
      console.log(JSON.stringify(r, null, 2));
      return r.allowed ? 0 : 1;
    }
    if (action === "snippet") {
      console.log(webauthnBrowserSnippet());
      return 0;
    }
    console.error(
      "Usage: xclaw auth webauthn <status|register-options|assert-options|gate|snippet>"
    );
    return 1;
  }

  if (sub === "import-grok") {
    const r = await importGrokCliAuth(cfg);
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  if (sub === "login") {
    const method = flag(args, "--method") || "auto";
    console.error("XClaw → Grok models auth");
    console.error("Method:", method);

    if (method === "api") {
      const key = process.env.XAI_API_KEY || process.env.XCLAW_API_KEY;
      if (key) {
        console.log(
          JSON.stringify(
            { ok: true, method: "api", hint: "XAI_API_KEY is set" },
            null,
            2
          )
        );
        return 0;
      }
      console.log(
        JSON.stringify(
          {
            ok: false,
            method: "api",
            steps: [
              "1. Open https://console.x.ai → API Keys",
              "2. Create key",
              "3. export XAI_API_KEY=xai-...",
              "4. xclaw auth status",
            ],
          },
          null,
          2
        )
      );
      return 1;
    }

    if (method === "web") {
      const info = webLoginInstructions(cfg);
      console.log(JSON.stringify(info, null, 2));
      console.error("\nAfter browser sign-in, run:");
      console.error(
        '  xclaw auth web-import --cookie "your_cookie_header"'
      );
      return 0;
    }

    const oauthMethod = method === "oauth" ? "auto" : method;
    const r = await loginXai(cfg, oauthMethod, {
      onCode: (info) => {
        console.error("\nOpen this URL and enter the code:\n");
        console.error("  ", info.verification_uri);
        console.error("\n  Code:", info.user_code, "\n");
      },
      onUrl: (url) => {
        console.error("\nOpen browser:\n");
        console.error("  ", url, "\n");
      },
    });

    console.log(JSON.stringify(r, null, 2));
    if (!r.ok && r.fallback) {
      console.error("\nAlternatives:");
      for (const line of r.fallback) console.error(" ", line);
      console.error("  xclaw auth login --method api");
      console.error("  xclaw auth login --method web");
    }
    return r.ok ? 0 : 1;
  }

  // Subcommands this CLI never implemented. They were unreachable while a
  // duplicate `case "auth"` held them, so unknown-sub must delegate before it
  // prints usage — otherwise restoring them is a rename nobody can invoke.
  if (sub === "connected" || sub === "token" || sub === "accounts") {
    const { runLegacyAuthCli } = await import("./auth-legacy-cli.mjs");
    return runLegacyAuthCli(cfg, ["auth", sub, ...args]);
  }
  if (sub === "login" && (args.includes("--connected") || args.includes("--oauth"))) {
    const { runLegacyAuthCli } = await import("./auth-legacy-cli.mjs");
    return runLegacyAuthCli(cfg, ["auth", sub, ...args]);
  }

  console.error(`Usage:
  xclaw auth modes
  xclaw auth login --method api|oauth|web|device|pkce|import-grok|auto
  xclaw auth web-import --cookie "..." | --file sess.json | --token "..."
  xclaw auth rotate
  xclaw auth rotation | rotation strategies
  xclaw auth fingerprint status|bind|verify|rotate
  xclaw auth gate
  xclaw auth logout
  xclaw auth status
  xclaw auth import-grok
  xclaw auth token | connected [list|status|login|refresh|logout|vault]
  xclaw auth accounts [list|link|unlink|create|normalize|migrate]`);
  return 1;
}
