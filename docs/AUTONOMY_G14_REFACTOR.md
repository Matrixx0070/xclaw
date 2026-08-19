# G14 multi-file refactor case

## Goal

Agent refactors across 2+ files with verify step.

## Design

- Fixture with `src/a.js` + `src/b.js` broken imports
- Expect both fixed + `verify.txt` contains OK
- Tags: autonomy, horizon, g14, refactor

## Local today

- G10–G13 offline suite + G12 synthetic + live key gate
