# XClaw Realtime Entity — talk without stopping the mind

**Principle:** Voice is a **mouth**, not the **brain**.  
While XClaw is speaking, agents, tools, swarm nodes, and heartbeats **keep running**.  
Barge-in stops **audio only** (or the speech epoch), never the cognitive workload — unless the user explicitly cancels the *task*.

This is the difference between a chatbot with TTS and a **next-gen real-time entity** (AGI/ASI-shaped control plane).

---

## 1. Dual-track model

```text
┌─────────────────────────────────────────────────────────────┐
│                     COGNITIVE PLANE (always on)              │
│  agent loop · tools · swarm · browser · merge · memory       │
│  jobs continue unless user says "stop / cancel that task"    │
└───────────────────────────┬─────────────────────────────────┘
                            │ status, partials, results
┌───────────────────────────▼─────────────────────────────────┐
│                     SPEECH PLANE (interruptible)             │
│  TTS epoch · playback · barge-in mute · casual replies       │
│  barge-in → stop mouth only; brain keeps working             │
└─────────────────────────────────────────────────────────────┘
```

| Event | Speech plane | Cognitive plane |
|-------|--------------|-----------------|
| User interrupts mid-sentence | **Mute TTS**, bump speech epoch | **Continue** tools/swarm |
| Long tool running | May speak progress updates | Tool **keeps going** |
| User: “stop talking” | Stop TTS | Unchanged |
| User: “cancel the research” | Optional ack TTS | **Abort** that job only |
| New question while tools run | New speech turn | Tools continue; answer may wait or interleave |

---

## 2. Epochs (two kinds)

| Epoch | Purpose | Barge-in effect |
|-------|---------|-----------------|
| **`speechEpoch`** | What may play on the speaker | Increment → drop stale PCM, stop player |
| **`jobEpoch` / `taskId`** | Unit of agent/swarm work | **Not** cleared by barge-in |

Only an explicit **cancel task** (or policy timeout) advances/kills `jobEpoch`.

```text
bargeIn() {
  speechEpoch++
  stopPlayback()
  // DO NOT abort agentController / swarm / tool runners
}
```

---

## 3. Entente = continuous partial presence

Like a human who keeps thinking while speaking:

1. **Narrate without blocking** — “I’m still scanning the repo…” while verify runs  
2. **Interleave** — speech turns and job events share one session timeline  
3. **Never single-thread the world** — voice I/O is one async consumer of a job bus  
4. **Priorities** — safety cancel > user task cancel > speech mute  

### Job bus events (spoken optionally)

| Event | Voice may say |
|-------|----------------|
| `job.started` | “On it.” |
| `job.progress` | Short status (throttled) |
| `job.done` | Summary / offer details |
| `job.failed` | Error, offer retry |
| `speech.barge_in` | (silence only) |

Progress TTS is **best-effort** and always on a **new speechEpoch** so it cannot fight barge-in.

---

## 4. Latency metrics (updated)

| Metric | Meaning |
|--------|---------|
| **mute_ms** | Time to stop speaker after user speech (speech plane only) |
| **job_continue_rate** | % of barge-ins where active jobs still running 1s later → **target ~100%** |
| **orphan_speech_rate** | Stale TTS after epoch bump → target 0 |
| **false_task_cancel_rate** | Barge-in wrongly aborted a job → target 0 |

**ASI-shaped SLO:** mute p95 &lt; 150 ms **and** job_continue_rate ≥ 99%.

---

## 5. User intents (NLU light)

| Utterance class | Action |
|-----------------|--------|
| Overlap / short interrupt | Barge-in speech only |
| “Shut up” / “stop talking” | Speech mute + suppress progress TTS |
| “Cancel that” / “stop the swarm” | Cancel **named or current job** |
| “Keep going” | Ack; no cancel |
| New task | Enqueue job; may speak in parallel with old job |

---

## 6. Implementation sketch (XClaw)

```text
src/voice/
  speech-plane.mjs   — TTS, epochs, barge-in, mute
  job-bus.mjs        — subscribe agent/swarm events
  entente.mjs        — policy: when to narrate vs stay silent
  session.mjs        — binds speechEpoch + activeJobs[]
```

Rules:

1. `spawnSubagent` / `runSwarmFanOut` / tool runners register **jobs** on the bus.  
2. Voice session **subscribes**; never owns the job lifecycle.  
3. `bargeIn()` touches **only** `speech-plane`.  
4. Cancel APIs are separate: `cancelJob(id)`, `cancelAllJobs()`.  

---

## 7. vs naive voice agents

| Naive | XClaw realtime entity |
|-------|------------------------|
| Talk = blocked agent turn | Talk ‖ agent |
| Barge-in kills everything | Barge-in kills audio |
| One thought at a time | Many jobs + one mouth |
| Silence = idle | Silence may mean “working” |

---

## 8. Bottom line

**While live XClaw is talking, agents do not stop.**  
The mouth yields; the mind does not — unless the user cancels the **work**, not the **words**.

That is the control plane for a next-generation real-time entity: continuous cognition, interruptible speech, explicit task cancellation.
