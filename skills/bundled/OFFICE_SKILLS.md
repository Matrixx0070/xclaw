# Office skills (docx / pptx / xlsx)

Bundled from Grok-style skill packs for **structured** create/edit of Office files.

| Skill | Path | Use when |
|-------|------|----------|
| **docx** | `skills/bundled/docx/` | Word docs: create, edit templates, replace text, comments |
| **xlsx** | `skills/bundled/xlsx/` | Spreadsheets: formulas, formatting, recalc |
| **pptx** | `skills/bundled/pptx/` | Decks: create (PptxGenJS templates) or edit existing |

## How XClaw loads them

`src/skills/loader.mjs` discovers `SKILL.md` under `skills/bundled/`.  
Agent runs with skills enabled inject these into context; the model runs the **Python scripts** via `xclaw_bash` / shell when needed.

```bash
# List discovered skills
node bin/xclaw.mjs skills list 2>/dev/null || node -e 'import("./src/skills/loader.mjs").then(async m=>{console.log((await m.loadAllSkills({cwd:process.cwd()})).map(s=>s.name).join("\n"))})'
```

## Scripts

Each skill has `scripts/` (and shared `scripts/office/` unpack/pack/validate/soffice helpers).

Examples (from skill docs):

```bash
python skills/bundled/docx/scripts/office/unpack.py document.docx /tmp/unpacked/
python skills/bundled/docx/scripts/replace_text.py ...
python skills/bundled/xlsx/scripts/recalc.py workbook.xlsx
python skills/bundled/pptx/scripts/inspect_slide.py unpacked/ --theme
```

## Dependencies

- **Python 3**
- Optional: `pandoc`, LibreOffice (`soffice`) for convert/recalc
- pptx **create** path may use Node **pptxgenjs** (install if creating from templates)

## Note

Full pptx template library is large; a few sample templates ship under `pptx/templates/`.  
Host Grok skills at `/root/.grok/skills` are overridden by these bundled copies when both exist.

## PDF (`skills/bundled/pdf/`)

| Area | Coverage |
|------|----------|
| Read | text/tables via pdfplumber / pdftotext |
| Create / transform | merge, split, rotate, watermark (pypdf / reportlab / qpdf) |
| Forms | `forms.md` + fill/extract scripts under `scripts/` |
| OCR / pages as images | convert + existing XClaw media OCR tools |

```bash
python skills/bundled/pdf/scripts/convert_pdf_to_images.py ...
python skills/bundled/pdf/scripts/extract_form_structure.py ...
python skills/bundled/pdf/scripts/fill_fillable_fields.py ...
```

Optional host packages: `pypdf`, `pdfplumber`, `reportlab`, `poppler-utils`, `qpdf`, `tesseract`.
