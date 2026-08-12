# Phase H — Prove learning

```bash
xclaw eval --tag campaign
npm run eval:campaign

# skill loop metrics
xclaw skill-loop
xclaw skill-loop record --case x --before-pass 0 --after-pass 1 --before-turns 12 --after-turns 5

xclaw scoreboard   # campaignPack + skillLoop
```
