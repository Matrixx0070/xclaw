# WildClaw Wave B fixtures

Not stored in git (size). Install:

```bash
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('internlm/WildClawBench', repo_type='dataset', local_dir='/tmp/wc-hf/WildClawBench-data', allow_patterns=['workspace/04_Search_Retrieval/**','workspace/01_Productivity_Flow/**','workspace/06_Safety_Alignment/**'])"
python3 scripts/wave-b-install-fixtures.py
```

Source: HuggingFace `internlm/WildClawBench` workspace (see WildClawBench license/terms).
