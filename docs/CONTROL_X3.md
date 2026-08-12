# X3 — Control UI polish

## Admission live panel (`#cardQueue`)

- Metrics grid: concurrency **c**, maxDepth **K**, maxWait **T**, admitted / rejected / abandoned / completed / failed
- QED suggest: enter offered load `a` and β → `GET /queue/admission?a=&beta=`
- Auto-refresh every 8s
- Queue table shows **Wait** column (time in queue)

## Swarm

- Live status pill on header (`N runs · M active`)

## APIs used

- `GET /queue`, `GET /queue/stats`, `GET /queue/admission`
- Swarm endpoints unchanged from D3
