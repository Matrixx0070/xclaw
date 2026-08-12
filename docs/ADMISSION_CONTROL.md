# X1 — Admission control (queue patience + concurrency)

## Policy (`cfg.queue`)

| Key | Default | Meaning |
|-----|---------|---------|
| `concurrency` | 1 | Parallel job workers (servers \(c\)) |
| `maxDepth` | 100 | Max **queued** jobs; excess → reject `QUEUE_FULL` |
| `maxWaitMs` | 300000 | Deterministic patience while queued; then `abandoned` |
| `maxConcurrencyCap` | 16 | Hard ceiling on concurrency |

## Mapping to theory

| Queueing concept | XClaw |
|------------------|--------|
| Servers \(c\) | `concurrency` |
| Finite buffer \(K\) | `maxDepth` (queued only) |
| Deterministic patience \(T\) | `maxWaitMs` (Erlang-A style abandon) |
| QED staffing \(a+\beta\sqrt{a}\) | `qedStaffing` / `GET /queue/admission?a=&beta=` |

## API

- `GET /queue/stats` — includes `admission` metrics  
- `GET /queue/admission` — policy + metrics + optional `?a=&beta=` or `?arrivalsPerSec=&meanServiceSec=`

## Metrics

`admitted`, `rejectedFull`, `abandonedWait`, `completed`, `failed`, `timedOutJob`
