# Account linking

Normalize channel users and optionally map many identities → one account (shared vault key).

## Identity format

```text
telegram:123456789
slack:U01ABCDEF
discord:987654321012345678
email:user@example.com
```

## CLI

```bash
xclaw auth accounts list
xclaw auth accounts normalize --channel telegram --user 123
xclaw auth accounts link --from slack:U01ABC --to telegram:123
xclaw auth accounts unlink slack:U01ABC
xclaw auth accounts create --primary slack:U01ABC --label "me"
xclaw auth accounts migrate acc_01HZXEXAMPLE
```

## Resolution

```text
normalizeChannelUserId → resolveAccountId → vault key = accountId || identity
```

`replyWithAgent` uses `resolveVaultUserId` so linked channels share OAuth tokens.

## Store

`~/.xclaw/accounts/links.json` (mode 0600)

## L2 — Pairing codes (chat)

```text
Channel A:  /link
            → Pairing code: XCLAW-AB12 (expires ~5m)

Channel B:  /link XCLAW-AB12
            → Accounts linked (shared vault)

            /link status
            /unlink
```

Codes are single-use, stored in `~/.xclaw/accounts/pairing.json`.

## L3 — Vault merge on link

When identities are linked, OAuth tokens under each identity vault folder are merged into `vault/<accountId>/`:

- Per `appId` (github, google, …): **newer `updatedAt` wins**
- Source folders renamed to `*.bak-<timestamp>` (not hard-deleted)

### Migration command example

After linking (CLI or `/link`), or when `xclaw doctor` warns that an identity vault is still present:

```bash
# 1. See accounts and identity links
xclaw auth accounts list
```

Example output:

```json
{
  "accounts": [
    {
      "id": "acc_fe213ec004c5daf443b28cc4",
      "primary": "slack:U01TEST",
      "identities": ["slack:U01TEST", "telegram:42"]
    }
  ],
  "links": {
    "slack:U01TEST": "acc_fe213ec004c5daf443b28cc4",
    "telegram:42": "acc_fe213ec004c5daf443b28cc4"
  }
}
```

```bash
# 2. Merge identity vaults into the account vault
xclaw auth accounts migrate acc_fe213ec004c5daf443b28cc4
```

Example result:

```json
{
  "ok": true,
  "accountId": "acc_fe213ec004c5daf443b28cc4",
  "apps": ["github", "google"],
  "merged": {
    "github": { "from": "telegram:42", "chose": "source" }
  },
  "backedUp": [
    "/home/you/.xclaw/vault/slack:U01TEST.bak-1730000000000",
    "/home/you/.xclaw/vault/telegram:42.bak-1730000000000"
  ],
  "errors": []
}
```

```bash
# 3. Confirm doctor is clean
xclaw doctor
```

Automatic merge already runs on `link` / `/link CODE`. Use **`migrate`** to re-run or finish a partial merge (e.g. identity folder left behind).
