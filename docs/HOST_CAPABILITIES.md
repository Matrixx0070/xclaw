# Host capabilities extracted from Grok sandbox

## Skills (bundled + ~/.grok/skills)

Office: docx, pptx, xlsx, pdf  
Media: ffmpeg, imagemagick, color, image-gen-edit  
Meta: mcp, memory-edit, tasks, skill-creator, skill-installer, finance, host-capabilities

## New agent tools

| Tool | Backend |
|------|---------|
| `file_type` | magika / file |
| `markitdown` | python -m markitdown |
| `host_capabilities` | probe CLIs + API env presence |

## Host CLIs commonly present

ffmpeg, ffprobe, convert/magick, pandoc, tesseract, magika, soffice (LibreOffice),
rg, python3, node, markitdown, pdfplumber, pdf2txt.py, pypdfium2

## Finance env (when set)

POLYGON_API_KEY, COINGECKO_PRO_API_KEY
