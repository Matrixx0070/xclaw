/**
 * xclaw auth: connected-OAuth, token and account-link subcommands.
 *
 * This lived inline in bin/xclaw.mjs as a SECOND `case "auth"`. JavaScript runs
 * the first matching case, so none of it was reachable: `xclaw auth accounts
 * list`, `auth connected list` and `auth token` all exited 1 on a real host
 * while the code sat in the dispatcher looking implemented. It is a module now
 * so the one live auth CLI can delegate to it and so it can be tested at all.
 */

export async function runLegacyAuthCli(cfg, argv = []) {
  const args = argv;
  const {
    loginWithApiKey,
    loginWithOAuth,
    logout,
    authStatus,
    resolveXaiToken,
  } = await import("../auth/xai.mjs");
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith("-")
      ? args[i + 1]
      : undefined;
  };
  const sub = args[1] || "status";
  if (sub === "status") {
    console.log(JSON.stringify(await authStatus(cfg), null, 2));
    return 0;
  }
  if (sub === "logout") {
    console.log(JSON.stringify(await logout(cfg), null, 2));
    return 0;
  }
  if (sub === "login") {
    const connectedIdx = args.indexOf("--connected");
    if (connectedIdx >= 0) {
      const app = args[connectedIdx + 1] || get("--app");
      if (!app || app.startsWith("--")) {
        console.error("Usage: xclaw auth login --connected github");
        return 1;
      }
      const { loginConnectedOAuth } = await import("../connected/oauth-login.mjs");
      const out = await loginConnectedOAuth(cfg, app, {
        scope: get("--scope") || undefined,
        redirectPort: get("--port") ? Number(get("--port")) : undefined,
      });
      console.log(JSON.stringify(out, null, 2));
      return out.ok ? 0 : 1;
    }
    const keyIdx = args.indexOf("--api-key");
    if (keyIdx >= 0 && args[keyIdx + 1]) {
      const out = await loginWithApiKey(cfg, args[keyIdx + 1]);
      try {
        const { loginApiKey } = await import("../auth/profiles.mjs");
        await loginApiKey(cfg, { provider: "xai", apiKey: args[keyIdx + 1] });
      } catch {}
      console.log(JSON.stringify(out, null, 2));
      return 0;
    }
    if (args.includes("--oauth")) {
      console.log(JSON.stringify(await loginWithOAuth(cfg), null, 2));
      return 0;
    }
    console.error(`Usage:
  xclaw auth login --api-key xai-...     # xAI API key
  xclaw auth login --oauth               # xAI experimental OIDC
  xclaw auth login --connected <app>     # browser OAuth (github|google)
  xclaw auth connected list|status|login|refresh
  xclaw auth status
  xclaw auth logout

Note: xAI public API uses API keys. Connected OAuth uses PKCE loopback.`);
    return 1;
  }
  if (sub === "connected") {
    const action = args[2] || "status";
    const {
      loginConnectedOAuth,
      refreshConnectedOAuth,
      connectedAuthStatus,
    } = await import("../connected/oauth-login.mjs");
    const { listConnectedOAuthProviders } = await import("../connected/oauth-providers.mjs");
    if (action === "list" || action === "providers") {
      console.log(JSON.stringify({ providers: listConnectedOAuthProviders() }, null, 2));
      return 0;
    }
    if (action === "status") {
      console.log(JSON.stringify(await connectedAuthStatus(cfg), null, 2));
      return 0;
    }
    if (action === "login") {
      const app = args[3] || get("--app") || get("--provider");
      if (!app) {
        console.error("Usage: xclaw auth connected login <github|google>");
        console.error("Set XCLAW_GITHUB_OAUTH_CLIENT_ID (and optional SECRET)");
        return 1;
      }
      const scope = get("--scope");
      const port = get("--port") ? Number(get("--port")) : undefined;
      const out = await loginConnectedOAuth(cfg, app, { scope, redirectPort: port });
      console.log(JSON.stringify(out, null, 2));
      return out.ok ? 0 : 1;
    }
    if (action === "refresh") {
      const app = args[3] || get("--app");
      if (!app) {
        console.error("Usage: xclaw auth connected refresh <github|google>");
        return 1;
      }
      const out = await refreshConnectedOAuth(cfg, app);
      console.log(JSON.stringify(out, null, 2));
      return out.ok ? 0 : 1;
    }
    if (action === "logout") {
      const { logoutConnected } = await import("../connected/oauth-login.mjs");
      const app = args[3] || get("--app") || "all";
      const out = await logoutConnected(cfg, app);
      console.log(JSON.stringify(out, null, 2));
      return 0;
    }
    if (action === "vault") {
      const { vaultListUsers, vaultListApps, vaultDeleteApp } = await import("../connected/vault.mjs");
      const vact = args[3] || "list-users";
      if (vact === "list-users") {
        console.log(JSON.stringify({ users: await vaultListUsers(cfg) }, null, 2));
        return 0;
      }
      if (vact === "list") {
        const user = args[4] || get("--user") || "default";
        console.log(JSON.stringify({ user, apps: await vaultListApps(cfg, user) }, null, 2));
        return 0;
      }
      if (vact === "delete") {
        const user = get("--user") || args[4];
        const app = get("--app") || args[5];
        if (!user || !app) {
          console.error("Usage: xclaw auth connected vault delete --user U --app github");
          return 1;
        }
        console.log(JSON.stringify(await vaultDeleteApp(cfg, user, app), null, 2));
        return 0;
      }
      console.error("Usage: xclaw auth connected vault [list-users|list|delete]");
      return 1;
    }
    console.error("Usage: xclaw auth connected [list|status|login|refresh|logout|vault]");
    return 1;
  }
  if (sub === "token") {
    const r = await resolveXaiToken(cfg);
    console.log(JSON.stringify({ hasToken: Boolean(r.token), source: r.source }, null, 2));
    return 0;
  }
  if (sub === "accounts") {
    const {
      listAccounts,
      linkIdentities,
      linkIdentity,
      unlinkIdentity,
      createAccount,
      normalizeChannelUserId,
      resolveVaultUserId,
    } = await import("../connected/account-links.mjs");
    const action = args[2] || "list";
    if (action === "list") {
      console.log(JSON.stringify(await listAccounts(cfg), null, 2));
      return 0;
    }
    if (action === "normalize") {
      const channel = get("--channel") || args[3];
      const user = get("--user") || args[4];
      console.log(JSON.stringify({
        identity: normalizeChannelUserId({ channel, userId: user }),
        vaultUserId: await resolveVaultUserId(cfg, { channel, userId: user }),
      }, null, 2));
      return 0;
    }
    if (action === "link") {
      const from = get("--from") || args[3];
      const to = get("--to") || args[4];
      if (!from || !to) {
        console.error("Usage: xclaw auth accounts link --from slack:U01 --to telegram:123");
        return 1;
      }
      const out = await linkIdentities(cfg, from, to);
      console.log(JSON.stringify(out, null, 2));
      return out.ok ? 0 : 1;
    }
    if (action === "unlink") {
      const id = get("--identity") || args[3];
      if (!id) {
        console.error("Usage: xclaw auth accounts unlink slack:U01");
        return 1;
      }
      console.log(JSON.stringify(await unlinkIdentity(cfg, id), null, 2));
      return 0;
    }
    if (action === "create") {
      const primary = get("--primary") || args[3];
      console.log(JSON.stringify(await createAccount(cfg, { primaryIdentity: primary, label: get("--label") }), null, 2));
      return 0;
    }
    if (action === "migrate") {
      const { migrateAccountVault } = await import("../connected/account-links.mjs");
      const id = get("--account") || args[3];
      if (!id) {
        console.error("Usage: xclaw auth accounts migrate <accountId>");
        console.error("Example: xclaw auth accounts migrate acc_fe213ec004c5daf443b28cc4");
        console.error("Tip:     xclaw auth accounts list   # copy id from accounts[].id");
        return 1;
      }
      const out = await migrateAccountVault(cfg, id);
      console.log(JSON.stringify(out, null, 2));
      return out.ok ? 0 : 1;
    }
    console.error("Usage: xclaw auth accounts [list|link|unlink|create|normalize|migrate]");
    return 1;
  }
  console.error("Usage: xclaw auth [status|login|logout|token|connected|accounts]");
  return 1;
}

export default { runLegacyAuthCli };
