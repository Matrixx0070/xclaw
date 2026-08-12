# SSH Certificate Authorities (CA)

OpenSSH certificates let a **CA private key** sign user or host keys. Servers trust the **CA public key** instead of individual `authorized_keys` entries.

## Roles

| Role | Key | Where |
|------|-----|--------|
| **CA** | Offline private + published public | Secrets vault / HSM |
| **User cert** | Signs employee `id_ed25519.pub` | Principals = login names |
| **Host cert** | Signs server host key | Principals = hostnames |

## Generate CA (once)

```bash
mkdir -p ~/ssh-ca && chmod 700 ~/ssh-ca
ssh-keygen -t ed25519 -f ~/ssh-ca/ca -C "xclaw-ssh-ca"
# Protect ca private key offline; distribute only ca.pub
```

Or via XClaw helper:

```js
import { generateSshCaKeypair } from "../src/git/ssh-ca.mjs";
await generateSshCaKeypair("/secure/ssh-ca");
```

## Sign a user key

```bash
ssh-keygen -s ~/ssh-ca/ca \
  -I "alice-laptop" \
  -n alice,ubuntu \
  -V +52w \
  -O clear -O permit-pty \
  ~/.ssh/id_ed25519.pub
# → ~/.ssh/id_ed25519-cert.pub
```

XClaw:

```js
import { signSshCertificate } from "../src/git/ssh-ca.mjs";
await signSshCertificate({
  caKey: "/secure/ssh-ca/ca",
  publicKey: "/home/alice/.ssh/id_ed25519.pub",
  principals: ["alice"],
  identity: "alice-laptop",
  validity: "+52w",
  certType: "user",
});
```

## Server trust (user CA)

`/etc/ssh/sshd_config.d/ca.conf`:

```text
TrustedUserCAKeys /etc/ssh/ca.pub
```

```bash
sudo cp ca.pub /etc/ssh/ca.pub
sudo systemctl reload sshd
```

Clients present **key + cert**; no per-user `authorized_keys` required (optional principals file).

## Client config

```sshconfig
Host *.example.com
  IdentityFile ~/.ssh/id_ed25519
  CertificateFile ~/.ssh/id_ed25519-cert.pub
  IdentitiesOnly yes
```

## Host certificates

```bash
ssh-keygen -s ca -h -I host.example.com -n host.example.com,host -V +52w /etc/ssh/ssh_host_ed25519_key.pub
```

`sshd_config`:

```text
HostCertificate /etc/ssh/ssh_host_ed25519_key-cert.pub
```

Clients `known_hosts`:

```text
@cert-authority *.example.com <CA_PUBLIC_KEY_LINE>
```

## Security

| Practice | Why |
|----------|-----|
| CA private key offline / HSM | Compromise = mint any principal |
| Short validity (`+1d` / `+1w`) | Limits stolen cert lifetime |
| Narrow principals | Least privilege |
| `RevokedKeys` | Force-expire lost certs |
| No agent forwarding to random hosts | Cert abuse still possible while valid |

## XClaw

SSH CA is **host/operator infrastructure**. XClaw agents use whatever SSH identity the OS provides (`CertificateFile` in `~/.ssh/config`). Helpers:

- `inspectSshCertificate` / `signSshCertificate` / `generateSshCaConfigSnippets`
- Module: `src/git/ssh-ca.mjs`

Do **not** store CA private keys in XClaw config or swarm worktrees.
