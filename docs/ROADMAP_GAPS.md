# Gap roadmap

**Full delivery map:** [PHASES_P0_P4.md](./PHASES_P0_P4.md)

# XClaw gap roadmap (post–v2.6 audit)

Goal: close remaining gaps vs Grok product tools, full Office skill packs, and production channels — without regressing reliability.

**Principles**
- Prefer **fail-soft** tools (clear errors, no crash)
- Ship **CLI/agent tools** before heavy UIs
- Use **existing host bins** (ffmpeg, soffice, tesseract) before new services
- API-dependent features require **documented env keys** and soft fallbacks

---

## Priority bands

| Band | Horizon | Theme |
|------|---------|--------|
| **P0** | Next 1–2 iterations | High leverage, mostly local, unblocks agent quality |
| **P1** | Near-term | Product-parity media + browser depth |
| **P2** | Mid-term | Channels + Office pack completeness |
| **P3** | Later | Platform polish, UNO scale, OAuth apps |

---

## P0 — Foundation fixes (do first)

**Status (v2.7.0): implemented** — Office trees synced (scripts), browser_screenshot/snapshot, Telegram media ingest, office_convert UNO optional.


| # | Item | Why | Deliverable | Effort |
|---|------|-----|-------------|--------|
| P0.1 | **Full Office skill trees** | Bundled docx/pptx/xlsx missing most scripts | Copy/sync `scripts/` (+ safe subset of templates) from `/root/.grok/skills`; verify `xclaw skills list` paths | M |
| P0.2 | **Browser screenshot tool** | Agents guess UI without pixels | `browser_screenshot` (or extend `xclaw_browser_tab` action) → PNG path under artifacts | S |
| P0.3 | **Browser snapshot / a11y tree** | Structured page understanding | `browser_snapshot` → compact DOM/text outline | M |
| P0.4 | **Telegram media ingest** | Users send photos/docs; bot ignores | Download media → workspace; inject path into agent prompt | M |
| P0.5 | **office_convert UNO optional** | Bulk evals pay cold-start cost | `cfg.office.unoUrl` + attach-to-listener path (doc already in `LIBREOFFICE_HEADLESS.md`) | M |

**Exit criteria:** Office skills file counts within ~80% of Grok; screenshot+snapshot usable in one agent turn; Telegram photo → OCR/path works; UNO mode documented + flaggable.

---

## P1 — Media & vision parity

**Status (v2.8.0): implemented**


| # | Item | Why | Deliverable | Effort |
|---|------|-----|-------------|--------|
| P1.1 | **view_x_video** | Gap vs Grok video tool | ffmpeg sample frames + optional subtitle/OCR strip | M |
| P1.2 | **search_images quality** | Current Openverse/Unsplash weak | Prefer xAI/Bing/Serp if keyed; keep fallback; always save to disk | M |
| P1.3 | **generate_image (real)** | Imagine API often missing | Confirm xAI image endpoint + model IDs; robust error; artifact path | M |
| P1.4 | **edit_image semantic** | Magick ops ≠ prompt edit | xAI image-edit if available; else multi-step Magick + clear limits | L |
| P1.5 | **view_image vision default** | OCR-only is weak | Stable vision model id; resize/cap bytes; cache | S |

**Exit criteria:** Image search returns ≥3 on-disk paths for common queries; gen/edit either work with key or fail with actionable message; video → frames path works offline.

---

## P2 — Channels & Office depth

**Status (v2.9.0): implemented**


| # | Item | Why | Deliverable | Effort |
|---|------|-----|-------------|--------|
| P2.1 | **Slack channel** | Team workflows | Socket mode or Events API; pairing + allowlist | L |
| P2.2 | **Email channel** | Ops / tickets | IMAP poll + SMTP reply; security allowlist | L |
| P2.3 | **Discord richness** | Threads, attachments | Attachment download; thread replies | M |
| P2.4 | **pptx templates pack** | Skill quality | Ship curated templates (size-capped) | M |
| P2.5 | **docx/xlsx script office helpers** | Match Grok automation | Port non-binary helpers; document soffice dependency | M |

**Exit criteria:** One non-Telegram chat path production-ready; Office scripts cover create/edit/inspect happy paths.

---

## P3 — Platform & connected apps

**Status (v3.0.0): implemented**


| # | Item | Why | Deliverable | Effort |
|---|------|-----|-------------|--------|
| P3.1 | **Connected OAuth catalog** | Grok `search_connected_tools` parity | Registry + token store; 1–2 real apps | L |
| P3.2 | **Neural TTS / Voice** | espeak is stub | Provider TTS API or local piper/coqui | M |
| P3.3 | **X semantic search** | Keyword-only is limited | API or xAI-backed semantic when available | M |
| P3.4 | **Multi-agent UI / artifacts** | Spawn only today | Job artifacts browser in webchat | L |
| P3.5 | **Clipboard + PDF-from-page tools** | Browser completeness | Thin CDP wrappers | S |
| P3.6 | **Sandbox persistence story** | Gateway dies in ephemeral hosts | systemd/docker compose docs + health watchdog | M |

---

## Suggested execution order (linear)

```text
P0.1 Office trees
  → P0.2 Screenshot
  → P0.3 Snapshot
  → P0.4 Telegram media
  → P0.5 UNO optional
P1.1 view_x_video
  → P1.5 vision defaults
  → P1.2–P1.4 image pipeline
P2.1 Slack or P2.2 Email (pick primary user channel)
  → P2.3–P2.5 Office polish
P3.* as demand requires
```

---

## Explicitly **out of scope** (for now)

- Replacing xAI with local GGUF weights on this sandbox (no model files present)
- Cloning proprietary Grok Imagine weights
- Guaranteeing X API without `X_BEARER_TOKEN`
- Full OpenClaw binary compatibility line-by-line

---

## Tracking

| Field | Value |
|-------|--------|
| Baseline version | 2.6.0 |
| Audit date | 2026-08-06 |
| Related docs | `FULL_TOOL_SURFACE.md`, `LIBREOFFICE_HEADLESS.md`, `HOST_CAPABILITIES.md`, `SKILLS.md` |

Update this file when a band closes; bump version per band (e.g. 2.7 = P0 done, 2.8 = P1, …).


## P4 — Production publish (v3.1.0)

**Status (v3.1.0): implemented**

1. Gateway auth + TLS
2. Slack Socket Mode
3. Imagine model matrix
4. Eval regression CI (`npm run eval:regression`)
5. Docker + publish docs
