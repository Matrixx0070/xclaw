# Image Generate Tool

Generate images from text prompts using AI image models.

## Usage

```javascript
const result = await tool.execute({
  prompt: "A futuristic city at sunset, cyberpunk style",
  size: "1024x1024",
  model: "dall-e-3",
  n: 1
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| prompt | string | yes | Image description |
| size | string | no | "256x256", "512x512", "1024x1024", "1792x1024", "1024x1792" |
| model | string | no | "dall-e-3", "dall-e-2", "stable-diffusion" |
| n | number | no | Number of images (1-10) |
| quality | string | no | "standard", "hd" |

## Returns

```json
{
  "images": [
    {
      "url": "https://...",
      "revised_prompt": "...",
      "size": "1024x1024"
    }
  ],
  "model": "dall-e-3",
  "total": 1
}
```

## Notes

- Requires API key for the image provider
- Images are stored temporarily (24h)
- Download promptly if you need to keep them
