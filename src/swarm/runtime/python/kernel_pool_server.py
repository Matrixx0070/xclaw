#!/usr/bin/env python3
"""
Jupyter Kernel POOL server — xclaw's layer on top of the operator-delivered
JupyterKernel class (jupyter_kernel.py, vendored from the extension zip).

The zip shipped a working single-kernel wrapper plus a management server
that could reset/interrupt but never execute. This adds what was missing:

  POST /execute {code, session?, timeout?}  — run code on the session's
       kernel (created lazily); Python STATE PERSISTS per session.
  POST /sessions/{sid}/reset      — fresh kernel for one session
  POST /sessions/{sid}/interrupt  — interrupt a running execution
  DELETE /sessions/{sid}          — shut a session's kernel down
  GET  /sessions                  — pool listing (age, last use, pid)
  GET  /health

Pool policy: kernels are created on first use per session id, capped at
MAX_KERNELS (LRU eviction), reaped after IDLE_TTL_S of inactivity.
Loopback only — kernels are arbitrary-code-execution surfaces.
"""

import argparse
import logging
import threading
import time
from typing import Dict, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from jupyter_kernel import JupyterKernel

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("kernel-pool")

MAX_KERNELS = 6
IDLE_TTL_S = 1800
REAP_INTERVAL_S = 60
MAX_CODE_CHARS = 100_000


class PoolEntry:
    def __init__(self, kernel: JupyterKernel):
        self.kernel = kernel
        self.created_at = time.time()
        self.last_used = time.time()
        self.lock = threading.Lock()


class ExecuteRequest(BaseModel):
    code: str
    session: str = "default"
    timeout: int = 60


pool: Dict[str, PoolEntry] = {}
pool_lock = threading.Lock()

app = FastAPI(title="XClaw Jupyter Kernel Pool", version="1.0.0")


def _get_entry(session: str) -> PoolEntry:
    with pool_lock:
        entry = pool.get(session)
        if entry is None:
            if len(pool) >= MAX_KERNELS:
                lru = min(pool, key=lambda s: pool[s].last_used)
                logger.info("pool full — evicting LRU session %s", lru)
                _shutdown(lru)
            logger.info("starting kernel for session %s", session)
            entry = PoolEntry(JupyterKernel())
            pool[session] = entry
        entry.last_used = time.time()
        return entry


def _shutdown(session: str):
    entry = pool.pop(session, None)
    if entry:
        try:
            entry.kernel.shutdown()
        except Exception as e:  # noqa: BLE001 — best-effort teardown
            logger.warning("shutdown of %s failed: %s", session, e)


def _reaper():
    while True:
        time.sleep(REAP_INTERVAL_S)
        now = time.time()
        with pool_lock:
            stale = [s for s, e in pool.items() if now - e.last_used > IDLE_TTL_S]
        for s in stale:
            logger.info("reaping idle session %s", s)
            with pool_lock:
                _shutdown(s)


threading.Thread(target=_reaper, daemon=True).start()


@app.post("/execute")
def execute(req: ExecuteRequest):
    if not req.code.strip():
        raise HTTPException(status_code=400, detail="code required")
    if len(req.code) > MAX_CODE_CHARS:
        raise HTTPException(status_code=400, detail=f"code too large (max {MAX_CODE_CHARS} chars)")
    timeout = max(1, min(int(req.timeout), 600))
    entry = _get_entry(req.session)
    # one execution at a time per kernel — jupyter_client channels are not
    # safe for interleaved consumers
    with entry.lock:
        result = entry.kernel.execute(req.code, timeout=timeout)
    entry.last_used = time.time()
    return {
        "success": result.success,
        "output": result.output,
        "error": result.error,
        "images": result.images or [],
        "session": req.session,
    }


@app.post("/sessions/{sid}/reset")
def reset_session(sid: str):
    entry = pool.get(sid)
    if not entry:
        raise HTTPException(status_code=404, detail="no such session")
    with entry.lock:
        out = entry.kernel.reset_kernel()
    return out


@app.post("/sessions/{sid}/interrupt")
def interrupt_session(sid: str):
    entry = pool.get(sid)
    if not entry:
        raise HTTPException(status_code=404, detail="no such session")
    return entry.kernel.interrupt_kernel()


@app.delete("/sessions/{sid}")
def delete_session(sid: str):
    if sid not in pool:
        raise HTTPException(status_code=404, detail="no such session")
    with pool_lock:
        _shutdown(sid)
    return {"success": True, "session": sid}


@app.get("/sessions")
def list_sessions():
    now = time.time()
    return {
        "sessions": [
            {
                "session": s,
                "ageSeconds": round(now - e.created_at),
                "idleSeconds": round(now - e.last_used),
                "kernelAlive": bool(e.kernel.km and e.kernel.km.is_alive()),
            }
            for s, e in pool.items()
        ],
        "max": MAX_KERNELS,
        "idleTtlSeconds": IDLE_TTL_S,
    }


@app.get("/health")
def health():
    return {"status": "ok", "kernels": len(pool), "max": MAX_KERNELS}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="XClaw Jupyter Kernel Pool")
    parser.add_argument("--host", default="127.0.0.1")  # loopback only
    parser.add_argument("--port", type=int, default=18799)
    args = parser.parse_args()
    logger.info("kernel pool listening on http://%s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
