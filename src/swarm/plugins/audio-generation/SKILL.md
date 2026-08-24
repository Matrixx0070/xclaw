# Audio Generation Tool

Generate REAL speech audio from text using the host's local TTS engine — piper neural voice when configured (`voice.piperBin`/`voice.piperModel` in xclaw config), espeak-ng fallback. No cloud APIs or keys; output is a WAV file under the swarm workspace (`artifacts/audio/`). Text-to-speech only — music and sound-effect generation are NOT provided.

## Usage

```javascript
// Text-to-speech
const result = await tool.execute({
  prompt: "Hello, welcome to XClaw",
  mode: "tts",
  voice: "alloy",
  format: "mp3"
});

// Music generation
const result = await tool.execute({
  prompt: "Upbeat electronic music for a workout",
  mode: "music",
  duration: 30
});

// Sound effects
const result = await tool.execute({
  prompt: "Thunderstorm with heavy rain",
  mode: "sfx",
  duration: 10
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| text | string | yes | Text to speak (max 500 chars per call) |
| filename | string | no | Output name without extension (letters/digits/dash) |

| Name | Type | Required | Description |
|------|------|----------|-------------|
| prompt | string | yes | Text prompt or description |
| mode | string | yes | "tts", "music", "sfx" |
| voice | string | no | Voice for TTS: alloy, echo, fable, onyx, nova, shimmer |
| format | string | no | "mp3", "opus", "aac", "flac", "wav", "pcm" |
| duration | number | no | Duration in seconds (for music/sfx) |
| speed | number | no | Playback speed (0.25-4.0, TTS only) |

## Returns

```json
{
  "audio_url": "https://...",
  "duration_seconds": 30,
  "mode": "music",
  "format": "mp3",
  "sample_rate": 44100
}
```

## Notes

- TTS max: 4096 characters
- Music max: 120 seconds
- SFX max: 22 seconds
- Audio files expire after 24 hours
