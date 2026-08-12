# Providers & model catalog

XClaw ships a **static catalog** (like OpenClaw) with many models per provider, plus optional **live discovery**.

## List

```bash
xclaw models providers
xclaw models list
xclaw models list --provider xai
xclaw models list --live              # merge GET {baseUrl}/models
xclaw models list --provider openai --live
```

## Built-in providers

| id | env key | notes |
|----|---------|--------|
| xai | XAI_API_KEY | Grok 4.x family |
| openai | OPENAI_API_KEY | GPT-4.1, 4o, o-series |
| anthropic | ANTHROPIC_API_KEY | Claude 4.x / 3.x |
| google | GEMINI_API_KEY | Gemini 2.5 / 1.5 |
| openrouter | OPENROUTER_API_KEY | Multi-vendor ids |
| deepseek | DEEPSEEK_API_KEY | Chat + Reasoner |
| groq | GROQ_API_KEY | Fast Llama / Mixtral |
| mistral | MISTRAL_API_KEY | Large, Codestral, Pixtral |
| together | TOGETHER_API_KEY | Open models |
| ollama | OLLAMA_API_KEY | Local `localhost:11434` |
| compatible | XCLAW_API_KEY | Any OpenAI-compatible baseUrl |

## Model refs

```text
xai/grok-4.5
openai/gpt-4.1
anthropic/claude-opus-4-6
google/gemini-2.5-pro
ollama/llama3.3
```

## Custom / extra models

```json
{
  "models": {
    "providers": {
      "xai": {
        "baseUrl": "https://api.x.ai/v1",
        "models": [
          { "id": "grok-4.5", "name": "Grok 4.5" },
          { "id": "my-finetune", "name": "Custom" }
        ]
      }
    }
  }
}
```

Custom provider entries **replace** the built-in definition for that id when set under `models.providers`.
To only add models, include the full list you want.

Or use a new id:

```json
{
  "models": {
    "providers": {
      "lmstudio": {
        "baseUrl": "http://127.0.0.1:1234/v1",
        "defaultModel": "local-model",
        "models": [{ "id": "local-model" }, { "id": "other" }]
      }
    }
  }
}
```


See [MODEL_DISCOVERY.md](./MODEL_DISCOVERY.md) for live refresh.
