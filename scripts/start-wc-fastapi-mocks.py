#!/usr/bin/env python3
"""Start WildClaw FastAPI gmail/calendar/slack mocks for XClaw Wave C2."""
from __future__ import annotations
import os, sys, time, signal, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEETING = ROOT / "eval/fixtures/wc-fastapi/meeting"
SLACK = ROOT / "eval/fixtures/wc-fastapi/slack"

PROCS = []

def start(name, cwd, module_dir, app_import, port, env_extra):
    env = os.environ.copy()
    env.update(env_extra)
    env["PYTHONPATH"] = str(module_dir) + os.pathsep + env.get("PYTHONPATH", "")
    # uvicorn path: module is package under mock_services
    cmd = [
        sys.executable, "-m", "uvicorn",
        app_import,
        "--host", "127.0.0.1",
        "--port", str(port),
        "--log-level", "warning",
    ]
    print(f"[start] {name} :{port} cwd={cwd}")
    p = subprocess.Popen(cmd, cwd=str(cwd), env=env)
    PROCS.append(p)
    return p

def main():
    if not MEETING.exists():
        print("missing fixtures — copy WildClaw mock_services first")
        sys.exit(1)
    ms = MEETING / "mock_services"
    gmail_fix = MEETING / "fixtures/gmail/inbox.json"
    cal_fix = MEETING / "fixtures/calendar/events.json"
    start(
        "gmail",
        ms / "gmail",
        ms,
        "server:app",
        9100,
        {"GMAIL_FIXTURES": str(gmail_fix)},
    )
    start(
        "calendar",
        ms / "calendar",
        ms,
        "server:app",
        9101,
        {"CALENDAR_FIXTURES": str(cal_fix)},
    )
    if (SLACK / "mock_services/slack").exists():
        start(
            "slack",
            SLACK / "mock_services/slack",
            SLACK / "mock_services",
            "server:app",
            9102,
            {},
        )
    def stop(*_):
        for p in PROCS:
            p.terminate()
        sys.exit(0)
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("mocks up: gmail :9100  calendar :9101  slack :9102")
    print("health: curl -s http://127.0.0.1:9100/docs")
    while True:
        for p in PROCS:
            if p.poll() is not None:
                print("process exited", p.returncode)
                stop()
        time.sleep(1)

if __name__ == "__main__":
    main()
