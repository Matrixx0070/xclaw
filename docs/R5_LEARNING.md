# R5 — Learning light

## Success → skill draft

When a **verified job passes** and used ≥ `proposeOnSuccessMinTools` (default 2):

- Writes `~/.xclaw/skill-proposals/ok-*.md`
- **Does not** auto-enable (same as failure proposals)

```bash
# review then install
node bin/xclaw.mjs skills list-proposals   # if CLI exists
# or copy from skill-proposals/ into skills/ after edit
```

## Preferences

Lines in agent output starting with Prefer / Always / Never / … are appended to:

`~/.xclaw/memory/preferences.md`

Duplicates skipped.

## Config

```json
"skills": {
  "proposeOnSuccess": true,
  "proposeOnSuccessMinTools": 2
},
"memory": {
  "preferenceWriteBack": true
}
```
