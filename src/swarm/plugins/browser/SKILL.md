# Browser Tool

Control a headless browser (Playwright) to navigate websites, take screenshots, click elements, and fill forms.

## Usage

```javascript
// Navigate
await tool.execute({ action: "navigate", url: "https://example.com" });

// Screenshot
await tool.execute({ action: "screenshot", selector: "body" });

// Click
await tool.execute({ action: "click", selector: "#submit" });

// Type
await tool.execute({ action: "type", selector: "#search", text: "hello" });
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | yes | "navigate", "screenshot", "click", "type", "scroll" |
| url | string | conditional | URL for navigate action |
| selector | string | conditional | CSS selector for click/type/screenshot |
| text | string | conditional | Text to type |
| wait_for | string | no | "load", "domcontentloaded", "networkidle" |

## Returns

```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "screenshot": "base64...",
  "html": "...",
  "status": 200
}
```

## Notes

- Uses Playwright Chromium
- Screenshots are base64-encoded PNGs
- Each sub-agent gets its own browser context
