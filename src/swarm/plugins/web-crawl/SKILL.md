# Web Crawl Tool

Crawl a website starting from a seed URL, following links up to a depth limit.

## Usage

```javascript
const result = await tool.execute({
  start_url: "https://docs.example.com",
  max_depth: 2,
  max_pages: 50,
  same_domain: true
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| start_url | string | yes | Starting URL |
| max_depth | number | no | Link depth (default 2) |
| max_pages | number | no | Max pages to crawl (default 50) |
| same_domain | boolean | no | Stay on same domain (default true) |

## Returns

```json
{
  "pages": [
    { "url": "...", "title": "...", "content": "...", "depth": 0 }
  ],
  "total": 50,
  "duration_ms": 12000
}
```

## Notes

- Respects robots.txt and crawl-delay
- Deduplicates by URL
- Parallel fetching with rate limiting
