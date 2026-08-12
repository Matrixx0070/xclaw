# Computer modules (Strategy C)

| Path | Role |
|------|------|
| `bash-tool.mjs`, `file-tools.mjs`, `browser-tab-tool.mjs` | **Maintained source** — edit these |
| `registry.mjs` | Tool registry for thin + future bundle entry |
| `*.extracted.mjs` | **Reference only** — line snapshots from the 16MB blob; do not extend features here |

## C2 status

- Maintained: bash, file read/write/edit, lightweight browser_tab
- Still bundle-only: HTTP main shell, skills-context, full BrowserService/CDP, network-details depth

```js
import { listMaintainedTools, executeMaintainedTool } from "./registry.mjs";
```
