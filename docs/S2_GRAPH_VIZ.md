# Swarm graph visualization (ASCII + Mermaid)

## ASCII waves (CLI)

```bash
node -e "
import { toAsciiWaves, examplePipelineGraph } from './src/agents/graph-viz.mjs';
console.log(toAsciiWaves(examplePipelineGraph(), { title: 'Swarm graph' }));
"
```

### Example output

```text
Swarm graph (3 waves)
wave 0  [✓ research:option A notes]  [✓ research:option B notes]
       └─ depends: (none)
wave 1  [… implement:wire GET /health]
       └─ depends: r1,r2
wave 2  [· verify:curl /health]
       └─ depends: impl
       └─ (critic appears in wave 3 when verify is a separate level)

legend: · pending  … running  ✓ done  ✗ error  ⏱ timeout  – skipped
```

With the full example pipeline (`r1,r2 → impl → verify → critic`):

```text
Swarm graph (4 waves)
wave 0  [✓ research:option A notes]  [✓ research:option B notes]
       └─ depends: (none)
wave 1  [… implement:wire GET /health]
       └─ depends: r1,r2
wave 2  [· verify:curl /health]
       └─ depends: impl
wave 3  [· critic:review risks]
       └─ depends: verify

legend: · pending  … running  ✓ done  ✗ error  ⏱ timeout  – skipped
```

Waves = topological levels: everything in `wave k` can run in parallel once prior waves finish.

## Mermaid

```js
import { toMermaid, examplePipelineGraph } from "../src/agents/graph-viz.mjs";
console.log(toMermaid(examplePipelineGraph()));
```

Paste into GitHub Markdown or mermaid.live.

## Graphviz DOT

```js
import { toDot, examplePipelineGraph } from "../src/agents/graph-viz.mjs";
console.log(toDot(examplePipelineGraph(), { title: "Swarm pipeline" }));
// optional: dot -Tsvg swarm.dot -o swarm.svg
```

Escaping:

- **Ids** (`escapeDotId`): bare if `^[A-Za-z_][A-Za-z0-9_]*$`, else quoted with `\` / `"` escaped
- **Labels** (`escapeDotLabel`): always quoted; `\`, `"`, newlines → `\n`
- **Edges**: both endpoints pass through `escapeDotId`

## API

| Function | Purpose |
|----------|---------|
| `topologicalWaves(nodes)` | Levels; throws on cycle |
| `toAsciiWaves(nodes, opts)` | CLI string |
| `toMermaid(nodes, opts)` | flowchart source |
| `toDot(nodes, opts)` | Graphviz DOT source |
| `escapeDotId` / `escapeDotLabel` | Safe DOT fragments |
| `examplePipelineGraph()` | Demo nodes |
