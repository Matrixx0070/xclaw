"""
XClaw MITM addon — mitmproxy scripting surface.

Features
--------
- Redacted flow summaries → flows.jsonl (agent tools: mitm_flows)
- Optional body snippets (req/res) with size limits + secret scrubbing
- Host allowlist (XCLAW_MITM_ALLOWLIST)
- Block list (XCLAW_MITM_BLOCK) — drop at requestheaders (before body) or request
- Path map (XCLAW_MITM_MAP) — rewrite request path prefix  old=>new,old2=>new2
- Inject response header X-XClaw-Mitm: 1 (debug)
- Optional strip Set-Cookie on responseheaders (XCLAW_MITM_STRIP_COOKIES=1)
- Optional full flow dump for matching hosts (XCLAW_MITM_DUMP_HOSTS)
- error / tls_failed_* → stats.json + flows.jsonl
- running → confdir/ready file for supervisor probe

mitmdump -s addons.py --set confdir=...

Env
---
  XCLAW_MITM_ALLOWLIST     comma hosts (empty = all)
  XCLAW_MITM_BLOCK          comma host|path substrings to kill
  XCLAW_MITM_MAP            oldPrefix=>newPrefix,...
  XCLAW_MITM_CAPTURE_BODY   1 = include body snippets in flows.jsonl
  XCLAW_MITM_BODY_MAX       max chars per body snippet (default 2048)
  XCLAW_MITM_DUMP_HOSTS     comma hosts → write full flow meta under dumps/
  XCLAW_MITM_STRIP_COOKIES  1 = strip Set-Cookie on responseheaders
  XCLAW_MITM_CONFDIR        fallback confdir if options.confdir unset

See docs/MITM_SCRIPTING.md for extending with custom addons.
Horizon 2: confdir/policy.json merged into block/map decisions.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from mitmproxy import ctx, http

# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------

REDACT_HEADERS = {
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-access-token",
    "x-csrf-token",
    "x-session-id",
}

SECRET_QUERY = re.compile(
    r"(api[_-]?key|token|secret|password|passwd|auth|session|bearer)=([^&]*)",
    re.I,
)

SECRET_BODY = re.compile(
    r'("?(?:password|passwd|secret|token|api[_-]?key|access_token|refresh_token|authorization)"?\s*[:=]\s*)("?)([^",\s}]+)\2',
    re.I,
)

BINARY_CT = re.compile(
    r"^(image/|audio/|video/|application/(octet-stream|pdf|zip|gzip|x-)|multipart/)",
    re.I,
)


def _csv_set(name: str) -> set[str] | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _allowlist() -> set[str] | None:
    return _csv_set("XCLAW_MITM_ALLOWLIST")


def _blocklist() -> set[str]:
    return _csv_set("XCLAW_MITM_BLOCK") or set()


def _dump_hosts() -> set[str]:
    return _csv_set("XCLAW_MITM_DUMP_HOSTS") or set()


def _maps() -> list[tuple[str, str]]:
    raw = os.environ.get("XCLAW_MITM_MAP", "").strip()
    if not raw:
        return []
    out: list[tuple[str, str]] = []
    for part in raw.split(","):
        if "=>" not in part:
            continue
        a, b = part.split("=>", 1)
        a, b = a.strip(), b.strip()
        if a:
            out.append((a, b))
    return out




def _load_file_policy() -> dict:
    """Horizon 2: optional policy.json in confdir."""
    try:
        p = _confdir() / "policy.json"
        if not p.is_file():
            return {}
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _policy_block_substrings() -> set[str]:
    """Union env blocklist + policy.json block rules."""
    out = set(_blocklist())
    pol = _load_file_policy()
    for rule in pol.get("rules") or []:
        if not isinstance(rule, dict):
            continue
        if rule.get("action") not in ("block", "deny"):
            continue
        m = rule.get("match") or {}
        for key in ("hostOrPathContains", "hostContains", "pathContains"):
            v = m.get(key)
            if v:
                out.add(str(v).lower())
    return out


def _policy_maps() -> list[tuple[str, str]]:
    out = list(_maps())
    pol = _load_file_policy()
    for rule in pol.get("rules") or []:
        if not isinstance(rule, dict) or rule.get("action") != "map":
            continue
        m = rule.get("match") or {}
        rw = rule.get("rewrite") or {}
        a, b = m.get("pathPrefix"), rw.get("pathPrefix")
        if a is not None and b is not None:
            out.append((str(a), str(b)))
    return out

def _capture_body() -> bool:
    return os.environ.get("XCLAW_MITM_CAPTURE_BODY", "").lower() in ("1", "true", "yes", "on")


def _body_max() -> int:
    try:
        return max(64, min(64_000, int(os.environ.get("XCLAW_MITM_BODY_MAX", "2048"))))
    except ValueError:
        return 2048


def _confdir() -> Path:
    try:
        d = ctx.options.confdir
        if d:
            return Path(d)
    except Exception:
        pass
    return Path(os.environ.get("XCLAW_MITM_CONFDIR", Path.home() / ".xclaw" / "mitm"))


def _flows_path() -> Path:
    return _confdir() / "flows.jsonl"


def _dumps_dir() -> Path:
    return _confdir() / "dumps"


def _host_allowed(host: str) -> bool:
    allow = _allowlist()
    if allow is None:
        return True
    h = host.lower()
    return h in allow or any(h.endswith("." + a) for a in allow)


def _is_blocked(host: str, path: str) -> bool:
    blob = f"{host}{path}".lower()
    for b in _policy_block_substrings():
        if b in blob:
            return True
    return False


def _redact_url(url: str) -> str:
    return SECRET_QUERY.sub(lambda m: f"{m.group(1)}=<redacted>", url)


def _redact_headers(headers) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        items = headers.items(multi=True)
    except TypeError:
        items = headers.items()
    for k, v in items:
        key = str(k)
        if key.lower() in REDACT_HEADERS:
            out[key] = "<redacted>"
        else:
            out[key] = str(v)[:500]
    return out


def _redact_body(text: str) -> str:
    return SECRET_BODY.sub(r"\1\2<redacted>\2", text)


def _body_snippet(flow: http.HTTPFlow, which: str) -> str | None:
    if not _capture_body():
        return None
    try:
        if which == "req":
            content = flow.request.content or b""
            ct = flow.request.headers.get("content-type", "")
        else:
            if not flow.response:
                return None
            content = flow.response.content or b""
            ct = flow.response.headers.get("content-type", "")
    except Exception:
        return None

    if not content:
        return ""
    if BINARY_CT.match(ct or "") or len(content) > 512_000:
        return f"<binary or large omitted ct={ct!r} bytes={len(content)}>"
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        return f"<decode-failed bytes={len(content)}>"
    text = _redact_body(text)
    mx = _body_max()
    if len(text) > mx:
        return text[:mx] + f"…(+{len(text) - mx} chars)"
    return text


def _apply_maps(flow: http.HTTPFlow) -> None:
    maps = _policy_maps()
    if not maps:
        return
    path = flow.request.path or "/"
    for old, new in maps:
        if path.startswith(old):
            flow.request.path = new + path[len(old) :]
            ctx.log.info(f"XClaw map {old} => {new} → {flow.request.path}")
            break


# ---------------------------------------------------------------------------
# Addon
# ---------------------------------------------------------------------------


class XClawFlows:
    """Primary XClaw addon: block, map, redact, log, errors, TLS failures."""

    def __init__(self) -> None:
        self.count = 0
        self.blocked = 0
        self.mapped = 0
        self.errors = 0
        self.tls_fail_client = 0
        self.tls_fail_server = 0
        self.cookies_stripped = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def load(self, loader) -> None:  # noqa: ANN001
        loader.add_option(
            name="xclaw_tag",
            typespec=str,
            default="xclaw",
            help="Tag written into flow summaries",
        )
        ctx.log.info("XClaw MITM addon loaded (hooks: requestheaders/request/responseheaders/response/error/tls_failed/running)")

    def configure(self, updated) -> None:  # noqa: ANN001
        if "xclaw_tag" in updated or not updated:
            ctx.log.info(f"XClaw tag={getattr(ctx.options, 'xclaw_tag', 'xclaw')}")

    def running(self) -> None:
        """Proxy fully up — write ready marker for supervisor / mitm_status."""
        try:
            conf = _confdir()
            conf.mkdir(parents=True, exist_ok=True)
            ready = conf / "ready"
            ready.write_text(
                json.dumps(
                    {
                        "ts": time.time(),
                        "tag": getattr(ctx.options, "xclaw_tag", "xclaw"),
                        "pid": os.getpid(),
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            self._write_stats()
            ctx.log.info(f"XClaw MITM running ready={ready}")
        except OSError as e:
            ctx.log.warn(f"XClaw ready file failed: {e}")

    def done(self) -> None:
        self._write_stats()
        try:
            ready = _confdir() / "ready"
            if ready.exists():
                ready.unlink()
        except OSError:
            pass
        ctx.log.info(
            f"XClaw MITM done flows={self.count} blocked={self.blocked} "
            f"mapped={self.mapped} errors={self.errors} "
            f"tls_client={self.tls_fail_client} tls_server={self.tls_fail_server}"
        )

    def _write_stats(self) -> None:
        try:
            conf = _confdir()
            conf.mkdir(parents=True, exist_ok=True)
            stats = {
                "ts": time.time(),
                "flows": self.count,
                "blocked": self.blocked,
                "mapped": self.mapped,
                "errors": self.errors,
                "tls_fail_client": self.tls_fail_client,
                "tls_fail_server": self.tls_fail_server,
                "cookies_stripped": self.cookies_stripped,
                "pid": os.getpid(),
            }
            (conf / "stats.json").write_text(
                json.dumps(stats, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass

    def _append_flow_row(self, summary: dict[str, Any]) -> None:
        try:
            path = _flows_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(summary, ensure_ascii=False) + "\n")
        except OSError as e:
            ctx.log.warn(f"XClaw flow write failed: {e}")

    # ------------------------------------------------------------------
    # HTTP — early hooks
    # ------------------------------------------------------------------

    def requestheaders(self, flow: http.HTTPFlow) -> None:
        """Headers only — block before body is buffered."""
        host = (flow.request.host or "").lower()
        path = flow.request.path or "/"
        if not _host_allowed(host):
            return
        if _is_blocked(host, path):
            self.blocked += 1
            flow.response = http.Response.make(
                403,
                b"Blocked by XClaw MITM (XCLAW_MITM_BLOCK)",
                {"Content-Type": "text/plain", "X-XClaw-Mitm": "blocked"},
            )
            ctx.log.warn(f"XClaw blocked@headers {host}{path}")
            self._write_stats()

    def request(self, flow: http.HTTPFlow) -> None:
        host = (flow.request.host or "").lower()
        path = flow.request.path or "/"

        if not _host_allowed(host):
            return

        # Already blocked in requestheaders?
        if flow.response is not None and flow.response.headers.get("X-XClaw-Mitm") == "blocked":
            return

        if _is_blocked(host, path):
            self.blocked += 1
            flow.response = http.Response.make(
                403,
                b"Blocked by XClaw MITM (XCLAW_MITM_BLOCK)",
                {"Content-Type": "text/plain", "X-XClaw-Mitm": "blocked"},
            )
            ctx.log.warn(f"XClaw blocked@request {host}{path}")
            self._write_stats()
            return

        before = flow.request.path
        _apply_maps(flow)
        if flow.request.path != before:
            self.mapped += 1

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        """Headers only — optional Set-Cookie strip without reading body."""
        if flow.response is None:
            return
        strip = os.environ.get("XCLAW_MITM_STRIP_COOKIES", "").lower() in (
            "1",
            "true",
            "yes",
            "on",
        )
        if not strip:
            return
        host = (flow.request.host or "").lower()
        if not _host_allowed(host):
            return
        # mitmproxy Headers supports del by name (all values)
        if "set-cookie" in flow.response.headers:
            try:
                del flow.response.headers["set-cookie"]
                self.cookies_stripped += 1
            except Exception:
                # Fallback: rebuild without set-cookie
                try:
                    items = [
                        (k, v)
                        for k, v in flow.response.headers.items(multi=True)
                        if k.lower() != "set-cookie"
                    ]
                    flow.response.headers.clear()
                    for k, v in items:
                        flow.response.headers.add(k, v)
                    self.cookies_stripped += 1
                except Exception as e:
                    ctx.log.warn(f"XClaw strip cookies failed: {e}")

    def response(self, flow: http.HTTPFlow) -> None:
        host = (flow.request.host or "").lower()
        if not _host_allowed(host):
            return

        if flow.response is not None:
            flow.response.headers["X-XClaw-Mitm"] = "1"

        self.count += 1
        summary: dict[str, Any] = {
            "ts": time.time(),
            "id": getattr(flow, "id", None) or f"f{self.count}",
            "kind": "http",
            "method": flow.request.method,
            "host": host,
            "path": flow.request.path,
            "url": _redact_url(flow.request.pretty_url),
            "status": flow.response.status_code if flow.response else None,
            "req_headers": _redact_headers(flow.request.headers),
            "content_type": (
                flow.response.headers.get("content-type", "") if flow.response else ""
            ),
            "size": len(flow.response.content or b"") if flow.response else 0,
            "tag": getattr(ctx.options, "xclaw_tag", "xclaw"),
        }

        req_body = _body_snippet(flow, "req")
        res_body = _body_snippet(flow, "res")
        if req_body is not None:
            summary["req_body"] = req_body
        if res_body is not None:
            summary["res_body"] = res_body

        self._append_flow_row(summary)

        dumps = _dump_hosts()
        if dumps and (host in dumps or any(host.endswith("." + d) for d in dumps)):
            try:
                ddir = _dumps_dir()
                ddir.mkdir(parents=True, exist_ok=True)
                dump = {
                    **summary,
                    "req_headers_full": _redact_headers(flow.request.headers),
                    "res_headers": _redact_headers(flow.response.headers)
                    if flow.response
                    else {},
                }
                name = f"{int(time.time() * 1000)}_{self.count}.json"
                (ddir / name).write_text(
                    json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8"
                )
            except OSError as e:
                ctx.log.warn(f"XClaw dump failed: {e}")

        if self.count % 25 == 0:
            self._write_stats()

    def error(self, flow: http.HTTPFlow) -> None:
        """Transport/protocol error (not HTTP 4xx/5xx)."""
        self.errors += 1
        host = ""
        url = ""
        try:
            host = (flow.request.host or "").lower() if flow.request else ""
            url = _redact_url(flow.request.pretty_url) if flow.request else ""
        except Exception:
            pass
        err_msg = ""
        try:
            err_msg = str(flow.error.msg) if flow.error else "unknown"
        except Exception:
            err_msg = "unknown"
        summary: dict[str, Any] = {
            "ts": time.time(),
            "id": getattr(flow, "id", None) or f"e{self.errors}",
            "kind": "error",
            "method": getattr(flow.request, "method", None) if flow.request else None,
            "host": host,
            "url": url,
            "status": None,
            "error": err_msg[:500],
            "tag": getattr(ctx.options, "xclaw_tag", "xclaw"),
        }
        self._append_flow_row(summary)
        self._write_stats()
        ctx.log.warn(f"XClaw flow error host={host} {err_msg[:120]}")

    # ------------------------------------------------------------------
    # TLS
    # ------------------------------------------------------------------

    def tls_failed_client(self, data) -> None:  # noqa: ANN001
        self.tls_fail_client += 1
        sni = ""
        try:
            sni = getattr(getattr(data, "context", None), "server", None)
            sni = getattr(sni, "address", None) or getattr(data, "conn", None)
            sni = str(sni)[:200]
        except Exception:
            sni = ""
        summary = {
            "ts": time.time(),
            "kind": "tls_failed_client",
            "detail": sni,
            "tag": getattr(ctx.options, "xclaw_tag", "xclaw"),
        }
        self._append_flow_row(summary)
        self._write_stats()
        ctx.log.warn(f"XClaw tls_failed_client {sni}")

    def tls_failed_server(self, data) -> None:  # noqa: ANN001
        self.tls_fail_server += 1
        detail = ""
        try:
            detail = str(getattr(data, "conn", None) or data)[:200]
        except Exception:
            detail = ""
        summary = {
            "ts": time.time(),
            "kind": "tls_failed_server",
            "detail": detail,
            "tag": getattr(ctx.options, "xclaw_tag", "xclaw"),
        }
        self._append_flow_row(summary)
        self._write_stats()
        ctx.log.warn(f"XClaw tls_failed_server {detail}")


class XClawEcho:
    """
    Example secondary addon: log WebSocket messages (redacted length only).
    """

    def websocket_message(self, flow: http.HTTPFlow) -> None:  # noqa: ANN001
        try:
            msg = flow.websocket.messages[-1] if flow.websocket else None
        except Exception:
            return
        if not msg:
            return
        host = (flow.request.host or "").lower()
        if not _host_allowed(host):
            return
        direction = "→" if getattr(msg, "from_client", False) else "←"
        size = len(getattr(msg, "content", b"") or b"")
        ctx.log.info(f"XClaw WS {direction} {host} bytes={size}")


# mitmproxy loads this list
addons = [XClawFlows(), XClawEcho()]
