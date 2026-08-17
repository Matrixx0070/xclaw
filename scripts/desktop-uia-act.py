#!/usr/bin/env python3
"""XClaw W2 — Windows UI Automation / SendInput act via pywinauto.

Requires: Windows + pywinauto + XCLAW_DESKTOP_GUI=1 (enforced by Node caller).

Args (CLI):
  click --x N --y N
  type  --text "..."
  key   --key "enter"   (or ctrl+s style best-effort)
  invoke --title "Window" --name "OK"   # UIA pattern by name under window title
"""
from __future__ import annotations

import json
import sys


def emit(obj: dict, code: int = 0) -> int:
    print(json.dumps(obj, ensure_ascii=False))
    return code


def parse_args(argv):
    action = (argv[1] if len(argv) > 1 else "click").lower()
    opts = {"action": action}
    i = 2
    while i < len(argv):
        a = argv[i]
        if a in ("--x", "--y") and i + 1 < len(argv):
            opts[a[2:]] = float(argv[i + 1])
            i += 2
        elif a in ("--text", "--key", "--title", "--name", "--button") and i + 1 < len(argv):
            opts[a[2:]] = argv[i + 1]
            i += 2
        else:
            i += 1
    return opts


def main() -> int:
    if sys.platform != "win32":
        return emit(
            {
                "ok": False,
                "code": "DESKTOP_GUI_UNSUPPORTED_OS",
                "error": f"UIA act only on Windows (got {sys.platform})",
                "platform": sys.platform,
            },
            2,
        )

    try:
        from pywinauto import mouse, keyboard
        from pywinauto import Desktop
    except ImportError as e:
        return emit(
            {
                "ok": False,
                "code": "UIA_NOT_INSTALLED",
                "error": f"pywinauto not available: {e}",
                "hint": "pip install pywinauto",
            },
            3,
        )

    opts = parse_args(sys.argv)
    action = opts.get("action", "click")

    try:
        if action == "click":
            x, y = opts.get("x"), opts.get("y")
            if x is None or y is None:
                return emit(
                    {"ok": False, "code": "DESKTOP_NEED_COORDS", "error": "click requires --x --y"},
                    4,
                )
            button = (opts.get("button") or "left").lower()
            # pywinauto mouse.click(coords=(x,y), button='left')
            mouse.click(button=button, coords=(int(x), int(y)))
            return emit(
                {
                    "ok": True,
                    "action": "click",
                    "backend": "pywinauto-mouse",
                    "x": int(x),
                    "y": int(y),
                    "engine": "desktop-uia",
                }
            )

        if action == "type":
            text = opts.get("text")
            if text is None:
                return emit(
                    {"ok": False, "code": "DESKTOP_NEED_TEXT", "error": "type requires --text"},
                    4,
                )
            keyboard.send_keys(text, with_spaces=True, pause=0.02)
            return emit(
                {
                    "ok": True,
                    "action": "type",
                    "backend": "pywinauto-keyboard",
                    "engine": "desktop-uia",
                }
            )

        if action == "key":
            key = opts.get("key")
            if not key:
                return emit(
                    {"ok": False, "code": "DESKTOP_NEED_KEY", "error": "key requires --key"},
                    4,
                )
            # Map simple names to pywinauto send_keys codes
            mapping = {
                "enter": "{ENTER}",
                "return": "{ENTER}",
                "tab": "{TAB}",
                "esc": "{ESC}",
                "escape": "{ESC}",
                "backspace": "{BACKSPACE}",
                "delete": "{DELETE}",
                "up": "{UP}",
                "down": "{DOWN}",
                "left": "{LEFT}",
                "right": "{RIGHT}",
            }
            seq = mapping.get(key.lower(), key)
            if "+" in key and not key.startswith("{"):
                # ctrl+s → ^s style
                parts = key.lower().split("+")
                mods = {"ctrl": "^", "control": "^", "alt": "%", "shift": "+"}
                out = ""
                char = parts[-1]
                for p in parts[:-1]:
                    out += mods.get(p, "")
                out += mapping.get(char, char)
                seq = out
            keyboard.send_keys(seq, pause=0.02)
            return emit(
                {
                    "ok": True,
                    "action": "key",
                    "key": key,
                    "backend": "pywinauto-keyboard",
                    "engine": "desktop-uia",
                }
            )

        if action == "invoke":
            title = opts.get("title")
            name = opts.get("name")
            if not name:
                return emit(
                    {
                        "ok": False,
                        "code": "DESKTOP_NEED_NAME",
                        "error": "invoke requires --name (and optional --title)",
                    },
                    4,
                )
            desk = Desktop(backend="uia")
            wins = desk.windows()
            target_win = None
            for w in wins:
                try:
                    t = w.window_text() or ""
                except Exception:
                    t = ""
                if title and title.lower() not in t.lower():
                    continue
                target_win = w
                if title:
                    break
            if target_win is None:
                return emit(
                    {
                        "ok": False,
                        "code": "UIA_WINDOW_NOT_FOUND",
                        "error": f"window not found title={title!r}",
                    },
                    5,
                )
            # depth-limited search for matching name
            found = []

            def walk(ctrl, depth=0):
                if depth > 12 or found:
                    return
                try:
                    info = ctrl.element_info
                    n = (getattr(info, "name", None) or "").strip()
                    if n and name.lower() in n.lower():
                        found.append(ctrl)
                        return
                except Exception:
                    pass
                try:
                    for ch in ctrl.children():
                        walk(ch, depth + 1)
                        if found:
                            return
                except Exception:
                    pass

            walk(target_win, 0)
            if not found:
                return emit(
                    {
                        "ok": False,
                        "code": "UIA_ELEMENT_NOT_FOUND",
                        "error": f"element name={name!r} not found",
                    },
                    6,
                )
            el = found[0]
            try:
                el.invoke()
            except Exception:
                try:
                    el.click_input()
                except Exception as e2:
                    return emit(
                        {"ok": False, "code": "UIA_INVOKE_FAILED", "error": str(e2)},
                        7,
                    )
            return emit(
                {
                    "ok": True,
                    "action": "invoke",
                    "name": name,
                    "title": title,
                    "backend": "pywinauto-uia",
                    "engine": "desktop-uia",
                }
            )

        return emit(
            {
                "ok": False,
                "code": "DESKTOP_ACT_UNKNOWN",
                "error": f"unsupported action: {action}",
            },
            8,
        )
    except Exception as e:
        return emit(
            {"ok": False, "code": "UIA_ACT_FAILED", "error": str(e)},
            9,
        )


if __name__ == "__main__":
    sys.exit(main())
