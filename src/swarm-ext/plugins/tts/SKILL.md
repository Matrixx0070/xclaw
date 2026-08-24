# TTS Tool

Convert text to speech using AI voice synthesis.

## Usage

```javascript
const result = await tool.execute({
  text: "Hello, this is a test of the text to speech system.",
  voice: "alloy",
  speed: 1.0,
  format: "mp3"
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| text | string | yes | Text to speak |
| voice | string | no | "alloy", "echo", "fable", "onyx", "nova", "shimmer" |
| speed | number | no | Playback speed (0.25-4.0) |
| format | string | no | "mp3", "opus", "aac", "flac", "wav", "pcm" |

## Returns

```json
{
  "audio_url": "https://...",
  "duration_seconds": 3.5,
  "voice": "alloy",
  "format": "mp3"
}
```

## Notes

- Max text length: 4096 characters
- Audio files expire after 24 hours
- Supports multiple languages
