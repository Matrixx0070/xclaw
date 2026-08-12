# IMM filter (Interacting Multiple Models)

Module: `src/utils/imm-filter.mjs`

## Cycle

1. **Mix** — blend model states with \(\mu\) and transition \(\pi\)
2. **Filter** — each model runs a 1D random-walk Kalman update
3. **Likelihood** — Gaussian innovation density
4. **Mode update** — \(\mu_j \propto L_j\, c_j\)
5. **Combine** — \(\hat x = \sum_j \mu_j x_j\)

## API

```js
import { createImmFilter, createDelayImm } from "../utils/imm-filter.mjs";

const imm = createDelayImm({ x0: 200, r: 1e6 });
const { estimate, mu, variance } = imm.step(measuredMs);
// mu[0] = smooth, mu[1] = agile

const { estimates, mus } = imm.filter(series);
```

## Defaults (`createDelayImm`)

| Model | Q |
|-------|---|
| smooth | 1e3 |
| agile | 1e6 |

Sticky transition: stay on smooth 0.92, stay on agile 0.85.
