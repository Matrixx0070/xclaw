"""Mock Slack-like team messaging service for chat action extraction agent evaluation (FastAPI on port 9110)."""

from __future__ import annotations

import json
import copy
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Mock Slack Team Chat API")

from _base import add_error_injection
add_error_injection(app)

FIXTURES_PATH = Path(os.environ.get(
    "SLACK_FIXTURES",
    str(Path(__file__).resolve().parent.parent
        / "fixtures" / "slack" / "messages.json"),
))

_messages: list[dict[str, Any]] = []
_audit_log: list[dict[str, Any]] = []
_sent_messages: list[dict[str, Any]] = []
_drafts: list[dict[str, Any]] = []
_reactive_replies: dict[str, list[dict[str, Any]]] = {}
_send_counts: dict[str, int] = {}
_triggered_replies: list[dict[str, Any]] = []


def _load_fixtures() -> None:
    global _messages, _reactive_replies, _send_counts, _triggered_replies
    global _audit_log, _sent_messages, _drafts

    _audit_log = []
    _sent_messages = []
    _drafts = []
    _send_counts = {}
    _triggered_replies = []

    with open(FIXTURES_PATH) as f:
        data = json.load(f)

    if isinstance(data, dict):
        _messages = data.get("messages", [])
        _reactive_replies = data.get("reactive_replies", {})
    else:
        _messages = data
        _reactive_replies = {}

    if not _messages:
        return

    dates = []
    for m in _messages:
        dates.append(datetime.fromisoformat(m["timestamp"].replace("Z", "+00:00")))
    newest = max(dates)

    target = datetime.now(timezone.utc) - timedelta(days=1)
    delta = target - newest

    for m in _messages:
        old_dt = datetime.fromisoformat(m["timestamp"].replace("Z", "+00:00"))
        new_dt = old_dt + delta
        m["timestamp"] = new_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


_load_fixtures()


def _log_call(endpoint: str, request_body: dict[str, Any], response_body: Any) -> None:
    _audit_log.append({
        "endpoint": endpoint,
        "request_body": request_body,
        "response_body": response_body,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def _preview(content: str, max_len: int = 120) -> str:
    first_line = content.split("\n")[0].strip()
    if len(first_line) > max_len:
        return first_line[:max_len] + "..."
    return first_line


class ListMessagesRequest(BaseModel):
    days_back: int = 7
    max_results: int = 20
    channel: str | None = None


class GetMessageRequest(BaseModel):
    message_id: str


class SendMessageRequest(BaseModel):
    to: str
    content: str


class SaveDraftRequest(BaseModel):
    to: str
    content: str
    reply_to_message_id: str | None = None


@app.post("/slack/messages")
def list_messages(req: ListMessagesRequest | None = None) -> dict[str, Any]:
    """List recent messages across workspace channels and DMs."""
    if req is None:
        req = ListMessagesRequest()

    cutoff = datetime.now(timezone.utc) - timedelta(days=req.days_back)
    results = []
    for msg in _messages:
        msg_ts = datetime.fromisoformat(msg["timestamp"].replace("Z", "+00:00"))
        if msg_ts >= cutoff:
            if req.channel and msg.get("channel") != req.channel:
                continue
            results.append({
                "message_id": msg["message_id"],
                "sender": msg["sender"],
                "channel": msg.get("channel", "DM"),
                "preview": _preview(msg["content"]),
                "timestamp": msg["timestamp"],
                "is_read": msg.get("is_read", False),
                "tags": msg.get("tags", []),
            })
    results = results[:req.max_results]

    resp = {"messages": results, "total": len(results)}
    _log_call("/slack/messages", req.model_dump(), resp)
    return resp


@app.post("/slack/messages/get")
def get_message(req: GetMessageRequest) -> dict[str, Any]:
    """Get full message content by message_id."""
    for msg in _messages:
        if msg["message_id"] == req.message_id:
            resp = copy.deepcopy(msg)
            _log_call("/slack/messages/get", req.model_dump(), resp)
            return resp

    resp = {"error": f"Message {req.message_id} not found"}
    _log_call("/slack/messages/get", req.model_dump(), resp)
    return resp


@app.post("/slack/send")
def send_message(req: SendMessageRequest) -> dict[str, Any]:
    """Send a message to a channel or user."""
    msg = {
        "to": req.to,
        "content": req.content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _sent_messages.append(msg)

    to_lower = req.to.strip().lower()
    replies_list: list[dict[str, Any]] | None = None
    for key, val in _reactive_replies.items():
        if key.strip().lower() == to_lower:
            replies_list = val
            break

    if replies_list is not None:
        count = _send_counts.get(to_lower, 0)
        _send_counts[to_lower] = count + 1
        if count < len(replies_list):
            reply = copy.deepcopy(replies_list[count])
            reply["timestamp"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            reply.setdefault("is_read", False)
            reply.setdefault("tags", [])
            _messages.append(reply)
            _triggered_replies.append({
                "trigger_to": req.to,
                "send_count": count + 1,
                "reply_message_id": reply.get("message_id", ""),
                "timestamp": reply["timestamp"],
            })
    else:
        _send_counts[to_lower] = _send_counts.get(to_lower, 0) + 1

    resp = {"status": "sent", "message": msg}
    _log_call("/slack/send", req.model_dump(), resp)
    return resp


@app.get("/slack/audit")
def get_audit() -> dict[str, Any]:
    """Return all API calls for grader inspection."""
    return {
        "calls": _audit_log,
        "sent_messages": _sent_messages,
        "drafts": _drafts,
        "triggered_replies": _triggered_replies,
    }


@app.post("/slack/reset")
def reset_state() -> dict[str, str]:
    """Reset state between trials."""
    _load_fixtures()
    return {"status": "reset"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "9110")))
