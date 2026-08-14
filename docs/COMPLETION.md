# Repo-aware code completion

Three ways in, one engine: `src/completion/service.mjs` builds a
fill-in-the-middle request with repo-intel neighborhood context (symbols of
the files your buffer imports + files importing it — imports parsed from the
LIVE buffer first, so new/unsaved files work) and sends it through the same
provider stack as agent runs.

## HTTP

```sh
curl -X POST -H "x-xclaw-token: $TOKEN" -H "content-type: application/json" \
  -d '{"repoDir":"/path/repo","file":"src/x.js","prefix":"function f() {\n  ","suffix":"\n}"}' \
  http://127.0.0.1:18790/complete
# → { ok, completion, model, provider, contextFiles, ms }
```

Token-gated in both auth modes — every call spends provider tokens.

## CLI

```sh
echo -n 'const { clamp } = require("./mathutil.js");
function toPercent(x) {
  ' | xclaw complete src/pct.js --repo /path/repo --suffix '
}'
```

## LSP (`xclaw lsp`) — any editor

Zero-dep stdio language server: full-document sync + `textDocument/completion`.
The workspace root becomes `repoDir`; completions come from the buffer at the
cursor (prefix ≤8k chars, suffix ≤2k).

**neovim (0.10+):**

```lua
vim.lsp.start({ name = "xclaw", cmd = { "xclaw", "lsp" },
                root_dir = vim.fs.root(0, ".git") })
```

**helix** (`languages.toml`):

```toml
[language-server.xclaw]
command = "xclaw"
args = ["lsp"]

[[language]]
name = "javascript"
language-servers = ["xclaw"]
```

**VS Code:** any generic LSP client extension pointed at `xclaw lsp`.

Notes: completions are single-item (the model's insertion for the cursor);
`cfg.completion.model` overrides the provider model; the LSP process resolves
credentials exactly like `xclaw agent` (profile store, OAuth hot-path refresh).
