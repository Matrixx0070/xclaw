# Web Extract Tool

Extract readable content, metadata, and structured data from a URL.

## Usage

```javascript
const result = await tool.execute({
  url: "https://example.com/article",
  extract_type: "article",
  include_images: false
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | string | yes | Target URL |
| extract_type | string | no | "article", "full", "metadata", "links" |
| include_images | boolean | no | Include image URLs |

## Returns

```json
{
  "title": "...",
  "author": "...",
  "published": "...",
  "content": "...",
  "images": [],
  "links": []
}
```
