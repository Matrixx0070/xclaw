# Web Search Tool

Search the internet and return ranked results with snippets.

## Usage

```javascript
const result = await tool.execute({
  query: "latest AI agent frameworks 2026",
  num_results: 10,
  engine: "google"
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | yes | Search query |
| num_results | number | no | Max results (default 10) |
| engine | string | no | "google", "bing", "duckduckgo" |

## Returns

```json
{
  "results": [
    { "title": "...", "url": "...", "snippet": "...", "rank": 1 }
  ],
  "total": 10,
  "engine": "google"
}
```

## Notes

- Respects robots.txt
- Rate-limited to 100 requests/minute
- Results cached for 1 hour
