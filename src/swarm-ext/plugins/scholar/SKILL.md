# Scholar Tool

Search REAL academic literature via the Semantic Scholar Graph API, with automatic OpenAlex fallback when the shared Semantic Scholar pool is rate-limited. (Google Scholar has no API and blocks automation.)

## Usage

```javascript
const result = await tool.execute({
  query: "transformer architecture attention mechanism",
  num_results: 10,
  sort_by: "relevance"
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | yes | Search query |
| num_results | number | no | Max results (default 10) |
| sort_by | string | no | "relevance", "date", "citations" |
| year_range | string | no | e.g., "2020-2026" |

## Returns

```json
{
  "papers": [
    {
      "title": "Attention Is All You Need",
      "authors": ["Vaswani et al."],
      "year": 2017,
      "citations": 89000,
      "url": "https://arxiv.org/abs/1706.03762",
      "snippet": "..."
    }
  ],
  "total": 10
}
```

## Notes

- No official Google Scholar API; uses SerpAPI or scraping in production
- Respect rate limits (max 10 requests/minute for scraping)
- Citation counts are approximate
