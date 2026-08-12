# Phase P0 complete (v2.7.0)

| Item | Status |
|------|--------|
| P0.1 Office skill trees | docx/pptx/xlsx scripts (+ office py helpers); pdf/ffmpeg/color refs |
| P0.2 browser_screenshot | Local tool → xclaw_browser_tab screenshot |
| P0.3 browser_snapshot | DOM headings/links/text via jsCode |
| P0.4 Telegram media | photo/document/voice/video/audio → telegram-media/ |
| P0.5 UNO optional | cfg.office.unoUrl + userInstallation |

## Config

```json
{
  "office": {
    "unoUrl": "socket,host=127.0.0.1,port=2002",
    "userInstallation": "/tmp/xclaw-lo-daemon"
  }
}
```

Or env: `XCLAW_LO_UNO_URL`, `XCLAW_LO_USER_INSTALLATION`.

Full detail: [PHASES_P0_P4.md](./PHASES_P0_P4.md)
