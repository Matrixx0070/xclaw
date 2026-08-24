# File Reader Tool

Read files from disk with automatic encoding detection and format parsing.

## Usage

```javascript
const result = await tool.execute({
  path: "/path/to/file.md",
  offset: 0,
  limit: 1000
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| path | string | yes | File path |
| offset | number | no | Start line/byte offset |
| limit | number | no | Max lines/bytes to read |
| encoding | string | no | "utf-8", "base64", "binary" |

## Returns

```json
{
  "path": "/path/to/file.md",
  "content": "...",
  "size": 1024,
  "encoding": "utf-8",
  "lines": 42,
  "parsed": null
}
```

## Supported Formats

- Text files (auto-detected encoding)
- JSON (parsed)
- CSV (parsed to arrays)
- Markdown (preserved as-is)
- Images (base64)
