# Skills

## Load order (later overrides same name)

1. `~/.xclaw/skills/<name>/SKILL.md`
2. `<project>/.xclaw/skills/`
3. XClaw `skills/bundled/` (shipped Grok parity skills)
4. XClaw `skills/`
5. `~/.grok/skills/` and `/root/.grok/skills/` (sandbox pre-builts)
6. `XCLAW_GROK_SKILLS` / `GROK_SKILLS_PATH` (extra dirs)

## Bundled / Grok pre-built skills

| Skill | Purpose |
|-------|---------|
| `docx` | Word documents |
| `pdf` | PDF create/read/OCR/forms |
| `pptx` | PowerPoint decks |
| `xlsx` | Spreadsheets |
| `ffmpeg` | Video/audio processing |
| `imagemagick` | Image processing |
| `color` | Color/palette help |
| `finance` | Markets / stocks |
| `image-gen-edit` | Image generate/edit policy |
| `mcp` | Connected MCP apps |
| `memory-edit` | Memory store policy |
| `tasks` | Scheduled tasks |
| `skill-creator` | Author new skills |
| `skill-installer` | Install skills from GitHub |

## CLI

```bash
# skills are injected automatically into agent context when relevant
# inspect via doctor / status once exposed
```
