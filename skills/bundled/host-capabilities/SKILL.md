---
name: host-capabilities
description: Use when checking what CLIs and conversion tools exist on the host (ffmpeg, ImageMagick, pandoc, tesseract, magika, LibreOffice, markitdown) or when choosing how to convert Office/PDF/media files.
---

# Host capabilities

Prefer the `host_capabilities` tool for a live probe.

| Task | Tool / CLI |
|------|------------|
| File type | `file_type` or `magika` / `file` |
| Doc → Markdown | `markitdown` tool |
| PDF | pdf skill + pdfplumber / pypdfium2 |
| Images | imagemagick skill + convert |
| Video/audio | ffmpeg skill |
| Office | docx/pptx/xlsx skills + soffice |
| OCR | tesseract |
| Markets | finance skill (Polygon / CoinGecko) |

Verify outputs exist after conversion. Prefer temp files then rename.
