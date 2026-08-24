# Swarm Deployment Guide

## Docker Compose (Recommended for Single Node)

```bash
cd docker
docker compose up -d --build
```

Services:
- `redis` — Task queue, pub/sub, session memory
- `orchestrator` — Main gateway + orchestrator
- `sandbox` — Optional isolated sub-agent runtime
- `prometheus` — Metrics (optional, profile `observability`)

## Kubernetes

### Namespace + ConfigMap

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: xclaw-swarm
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: xclaw-swarm-config
  namespace: xclaw-swarm
data:
  xclaw-swarm.json: |
    {
      "swarm": {
        "orchestrator": { "maxSubAgents": 100 },
        "subAgent": { "maxConcurrent": 100 }
      }
    }
```

### Orchestrator Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: xclaw-orchestrator
  namespace: xclaw-swarm
spec:
  replicas: 2
  selector:
    matchLabels:
      app: xclaw-orchestrator
  template:
    metadata:
      labels:
        app: xclaw-orchestrator
    spec:
      containers:
        - name: orchestrator
          image: xclaw-swarm-orchestrator:latest
          ports:
            - containerPort: 18790
          env:
            - name: REDIS_URL
              value: "redis://xclaw-redis:6379/0"
            - name: XCLAW_GATEWAY_TOKEN
              valueFrom:
                secretKeyRef:
                  name: xclaw-secrets
                  key: gateway-token
          resources:
            limits:
              memory: "2Gi"
              cpu: "2000m"
            requests:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /api/swarm/health
              port: 18790
            initialDelaySeconds: 10
            periodSeconds: 30
```

### Redis StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: xclaw-redis
  namespace: xclaw-swarm
spec:
  serviceName: xclaw-redis
  replicas: 1
  selector:
    matchLabels:
      app: xclaw-redis
  template:
    metadata:
      labels:
        app: xclaw-redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          volumeMounts:
            - name: redis-data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: redis-data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

## Scaling

### Horizontal Scaling

The orchestrator is stateless (state lives in Redis). Scale replicas:

```bash
kubectl scale deployment xclaw-orchestrator --replicas=5
```

### Sub-Agent Scaling

Sub-agents run as ephemeral containers or processes. In Docker:

```bash
# The pool auto-scales up to maxConcurrent (default 300)
# To increase, update xclaw-swarm.json and restart
```

In K8s, use a Job per sub-agent batch:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: xclaw-subagent-batch
spec:
  parallelism: 50
  template:
    spec:
      containers:
        - name: subagent
          image: xclaw-swarm-subagent:latest
          env:
            - name: TASK_QUEUE_URL
              value: "redis://xclaw-redis:6379/0"
      restartPolicy: Never
```

## Production Checklist

- [ ] Set `XCLAW_PROFILE=prod`
- [ ] Set `XCLAW_GATEWAY_TOKEN` to a strong random secret
- [ ] Enable egress `deny` or `allowlist`
- [ ] Enable OS sandbox (`bubblewrap` installed)
- [ ] Set `budget.enabled=true` with reasonable limits
- [ ] Enable Prometheus metrics
- [ ] Configure log aggregation (stdout → fluentd/vector)
- [ ] Set Redis persistence (AOF + RDB)
- [ ] Run `npm run swarm:doctor` before deploy
- [ ] Test receipt validation on sample tasks

## Monitoring

### Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `swarm_task_count` | Counter | Total tasks submitted |
| `swarm_sub_agent_count` | Gauge | Active sub-agents |
| `swarm_tool_call_count` | Counter | Total tool calls |
| `swarm_latency_seconds` | Histogram | Task execution latency |
| `swarm_error_rate` | Gauge | Error percentage |
| `swarm_token_usage` | Counter | Total tokens consumed |
| `swarm_parallel_ratio` | Gauge | Avg parallelism per task |

### Alerts

```yaml
# Example PrometheusRule
- alert: SwarmHighErrorRate
  expr: swarm_error_rate > 0.1
  for: 5m
  labels:
    severity: warning
- alert: SwarmQueueBacklog
  expr: swarm_queue_pending > 1000
  for: 10m
  labels:
    severity: critical
```

## Backup

```bash
npm run swarm:backup
# Backs up:
# - Redis RDB snapshot
# - PARL training samples
# - Session memory
# - Receipts
```

## Migration

```bash
npm run swarm:migrate -- --from 0.1.0 --to 0.2.0
```
