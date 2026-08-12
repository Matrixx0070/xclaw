# Media skills

| Skill | Path | Role |
|-------|------|------|
| **ffmpeg** | `skills/bundled/ffmpeg/` | Full edit pipeline: convert, trim, concat, compress, GIF, subtitles, overlays |
| **imagemagick** | `skills/bundled/imagemagick/` | Still-image ops (if present) |

## FFmpeg

- `SKILL.md` — safety (`-n` default, temp-file workflow), decision logic
- `references/recipes.md` — convert, remux, extract/replace audio, GIF, subtitles, overlays, …

Agent runs **ffmpeg/ffprobe** via shell (`xclaw_bash`). Host needs `ffmpeg` installed (CI: `unit-media` job).

XClaw also has code tools: `view_x_video` / media tools for probe + frame sample; prefer this **skill** for multi-step edit pipelines.
