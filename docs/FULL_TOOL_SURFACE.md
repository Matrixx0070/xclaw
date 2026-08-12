# XClaw full tool surface (v2.6)

## Computer server
- xclaw_bash, xclaw_file_read, xclaw_file_write, xclaw_file_edit
- xclaw_browser_tab, xclaw_browser_network_details

## Local agent tools
### Search / files
glob, grep, web_fetch, web_search, file_type, markitdown, host_capabilities

### Media / docs
ocr, office_convert, view_image, search_images, generate_image, edit_image

### Finance
finance_quote (Polygon + CoinGecko)

### X (Twitter)
x_keyword_search, x_user_search, x_thread_fetch  
(Requires `X_BEARER_TOKEN` for full API; keyword search has DDG fallback)

### Connected
search_connected_tools, call_connected_tool (voice_speak via espeak)

## Env keys
XAI_API_KEY, POLYGON_API_KEY, COINGECKO_PRO_API_KEY, X_BEARER_TOKEN, XCLAW_IMAGE_MODEL, XCLAW_VISION_MODEL

See [LIBREOFFICE_HEADLESS.md](./LIBREOFFICE_HEADLESS.md) for CLI + UNO patterns.
