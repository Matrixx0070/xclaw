# Phase P1 complete (v2.8.0)

| Item | Status |
|------|--------|
| P1.1 view_x_video | ffmpeg probe + evenly spaced frames; optional subs + OCR |
| P1.2 search_images | Bing → SerpAPI → Openverse → Unsplash; disk paths |
| P1.3 generate_image | Multi model/endpoint try; clear fallback message |
| P1.4 edit_image | API attempt + prompt→Magick op mapping |
| P1.5 view_image vision | Multi-model vision retry (grok-2-vision-*) |

## Env

```bash
XAI_API_KEY
XCLAW_IMAGE_MODEL
XCLAW_VISION_MODEL
BING_SEARCH_KEY   # optional, best image search
SERPAPI_API_KEY   # optional
```

Full detail: [PHASES_P0_P4.md](./PHASES_P0_P4.md)
