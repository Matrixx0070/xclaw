#!/usr/bin/env python3
"""XClaw M2 — macOS act via CGEvent (+ optional AXPress by name).

Requires: darwin + pyobjc + Accessibility TCC.
Node enforces XCLAW_DESKTOP_GUI=1 before calling.

Actions:
  click --x N --y N
  type  --text "..."
  key   --key "enter" | "cmd+s" | ...
  invoke --name "Save" [--app "TextEdit"]  # AXPress if possible else click center
"""
from __future__ import annotations

import json
import sys
import time


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
        elif a in ("--text", "--key", "--name", "--app", "--button") and i + 1 < len(argv):
            opts[a[2:]] = argv[i + 1]
            i += 2
        else:
            i += 1
    return opts


def main() -> int:
    if sys.platform != "darwin":
        return emit(
            {
                "ok": False,
                "code": "DESKTOP_GUI_UNSUPPORTED_OS",
                "error": f"AX/CGEvent act only on macOS (got {sys.platform})",
                "platform": sys.platform,
            },
            2,
        )

    try:
        import Quartz
        from ApplicationServices import AXIsProcessTrusted
    except ImportError as e:
        return emit(
            {
                "ok": False,
                "code": "AX_NOT_INSTALLED",
                "error": f"pyobjc Quartz/ApplicationServices missing: {e}",
                "hint": "pip install pyobjc-framework-Quartz pyobjc-framework-ApplicationServices",
            },
            3,
        )

    if not AXIsProcessTrusted():
        return emit(
            {
                "ok": False,
                "code": "AX_TCC_REQUIRED",
                "error": "Accessibility permission not granted",
                "hint": "System Settings → Privacy & Security → Accessibility",
            },
            4,
        )

    opts = parse_args(sys.argv)
    action = opts.get("action", "click")

    def post_mouse(x, y, down=True, button="left"):
        b = Quartz.kCGMouseButtonLeft
        if button == "right":
            b = Quartz.kCGMouseButtonRight
        et_down = Quartz.kCGEventLeftMouseDown if b == Quartz.kCGMouseButtonLeft else Quartz.kCGEventRightMouseDown
        et_up = Quartz.kCGEventLeftMouseUp if b == Quartz.kCGMouseButtonLeft else Quartz.kCGEventRightMouseUp
        et = et_down if down else et_up
        ev = Quartz.CGEventCreateMouseEvent(None, et, (x, y), b)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)

    def move_to(x, y):
        ev = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (x, y), Quartz.kCGMouseButtonLeft)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)

    try:
        if action == "click":
            x, y = opts.get("x"), opts.get("y")
            if x is None or y is None:
                return emit(
                    {"ok": False, "code": "DESKTOP_NEED_COORDS", "error": "click requires --x --y"},
                    5,
                )
            button = (opts.get("button") or "left").lower()
            move_to(float(x), float(y))
            time.sleep(0.02)
            post_mouse(float(x), float(y), True, button)
            time.sleep(0.03)
            post_mouse(float(x), float(y), False, button)
            return emit(
                {
                    "ok": True,
                    "action": "click",
                    "backend": "cgevent",
                    "x": int(x),
                    "y": int(y),
                    "engine": "desktop-ax",
                }
            )

        if action == "type":
            text = opts.get("text")
            if text is None:
                return emit(
                    {"ok": False, "code": "DESKTOP_NEED_TEXT", "error": "type requires --text"},
                    5,
                )
            for ch in text:
                # Unicode via CGEventKeyboardSetUnicodeString
                ev = Quartz.CGEventCreateKeyboardEvent(None, 0, True)
                Quartz.CGEventKeyboardSetUnicodeString(ev, len(ch), ch)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
                ev_up = Quartz.CGEventCreateKeyboardEvent(None, 0, False)
                Quartz.CGEventKeyboardSetUnicodeString(ev_up, len(ch), ch)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev_up)
                time.sleep(0.01)
            return emit(
                {
                    "ok": True,
                    "action": "type",
                    "backend": "cgevent",
                    "engine": "desktop-ax",
                }
            )

        if action == "key":
            key = opts.get("key") or ""
            if not key:
                return emit(
                    {"ok": False, "code": "DESKTOP_NEED_KEY", "error": "key requires --key"},
                    5,
                )
            # Minimal virtual key map (US layout)
            VK = {
                "enter": 36,
                "return": 36,
                "tab": 48,
                "esc": 53,
                "escape": 53,
                "space": 49,
                "delete": 51,
                "backspace": 51,
                "up": 126,
                "down": 125,
                "left": 123,
                "right": 124,
            }
            mods = {
                "cmd": Quartz.kCGEventFlagMaskCommand,
                "command": Quartz.kCGEventFlagMaskCommand,
                "shift": Quartz.kCGEventFlagMaskShift,
                "alt": Quartz.kCGEventFlagMaskAlternate,
                "option": Quartz.kCGEventFlagMaskAlternate,
                "ctrl": Quartz.kCGEventFlagMaskControl,
                "control": Quartz.kCGEventFlagMaskControl,
            }
            parts = [p.strip().lower() for p in key.split("+")]
            flags = 0
            main = parts[-1]
            for p in parts[:-1]:
                flags |= mods.get(p, 0)
            vk = VK.get(main)
            if vk is None and len(main) == 1:
                # letter: use unicode type path
                ev = Quartz.CGEventCreateKeyboardEvent(None, 0, True)
                if flags:
                    Quartz.CGEventSetFlags(ev, flags)
                Quartz.CGEventKeyboardSetUnicodeString(ev, 1, main)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
                ev_up = Quartz.CGEventCreateKeyboardEvent(None, 0, False)
                if flags:
                    Quartz.CGEventSetFlags(ev_up, flags)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev_up)
            elif vk is not None:
                ev = Quartz.CGEventCreateKeyboardEvent(None, vk, True)
                if flags:
                    Quartz.CGEventSetFlags(ev, flags)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
                ev_up = Quartz.CGEventCreateKeyboardEvent(None, vk, False)
                if flags:
                    Quartz.CGEventSetFlags(ev_up, flags)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev_up)
            else:
                return emit(
                    {"ok": False, "code": "DESKTOP_ACT_UNKNOWN", "error": f"unsupported key: {key}"},
                    6,
                )
            return emit(
                {
                    "ok": True,
                    "action": "key",
                    "key": key,
                    "backend": "cgevent",
                    "engine": "desktop-ax",
                }
            )

        if action == "invoke":
            # Prefer coordinate click after AX lookup for reliability on Electron
            name = opts.get("name")
            if not name:
                return emit(
                    {"ok": False, "code": "DESKTOP_NEED_NAME", "error": "invoke requires --name"},
                    5,
                )
            # Reuse observe-style walk — import limited AX APIs
            from ApplicationServices import (
                AXUIElementCreateApplication,
                AXUIElementCopyAttributeValue,
                kAXErrorSuccess,
                kAXRoleAttribute,
                kAXTitleAttribute,
                kAXChildrenAttribute,
                kAXPositionAttribute,
                kAXSizeAttribute,
                kAXWindowsAttribute,
                kAXPressAction,
                AXUIElementPerformAction,
            )
            from Cocoa import NSWorkspace

            def ax_get(el, attr):
                err, val = AXUIElementCopyAttributeValue(el, attr, None)
                return val if err == kAXErrorSuccess else None

            def ax_box(el):
                pos = ax_get(el, kAXPositionAttribute)
                size = ax_get(el, kAXSizeAttribute)
                if pos is None or size is None:
                    return None
                try:
                    x = float(getattr(pos, "x", pos[0]))
                    y = float(getattr(pos, "y", pos[1]))
                    w = float(getattr(size, "width", size[0]))
                    h = float(getattr(size, "height", size[1]))
                    return x, y, w, h
                except Exception:
                    return None

            found = []
            app_filter = opts.get("app")

            def walk(el, depth=0):
                if found or depth > 12:
                    return
                role = ax_get(el, kAXRoleAttribute) or ""
                title = (ax_get(el, kAXTitleAttribute) or "") or ""
                if name.lower() in title.lower():
                    found.append(el)
                    return
                for ch in ax_get(el, kAXChildrenAttribute) or []:
                    walk(ch, depth + 1)
                    if found:
                        return

            for app in NSWorkspace.sharedWorkspace().runningApplications():
                aname = app.localizedName() or ""
                if app_filter and app_filter.lower() not in aname.lower():
                    continue
                app_el = AXUIElementCreateApplication(app.processIdentifier())
                wins = ax_get(app_el, kAXWindowsAttribute) or [app_el]
                for w in wins:
                    walk(w, 0)
                    if found:
                        break
                if found:
                    break

            if not found:
                return emit(
                    {
                        "ok": False,
                        "code": "AX_ELEMENT_NOT_FOUND",
                        "error": f"element name={name!r} not found",
                    },
                    7,
                )
            el = found[0]
            # Try AXPress first
            try:
                err = AXUIElementPerformAction(el, kAXPressAction)
                if err == 0:  # kAXErrorSuccess
                    return emit(
                        {
                            "ok": True,
                            "action": "invoke",
                            "name": name,
                            "backend": "axpress",
                            "engine": "desktop-ax",
                        }
                    )
            except Exception:
                pass
            box = ax_box(el)
            if not box:
                return emit(
                    {
                        "ok": False,
                        "code": "AX_INVOKE_FAILED",
                        "error": "no AXPress and no bbox",
                    },
                    8,
                )
            x, y, w, h = box
            cx, cy = x + w / 2, y + h / 2
            move_to(cx, cy)
            time.sleep(0.02)
            post_mouse(cx, cy, True)
            time.sleep(0.03)
            post_mouse(cx, cy, False)
            return emit(
                {
                    "ok": True,
                    "action": "invoke",
                    "name": name,
                    "backend": "cgevent-fallback",
                    "x": int(cx),
                    "y": int(cy),
                    "engine": "desktop-ax",
                }
            )

        return emit(
            {
                "ok": False,
                "code": "DESKTOP_ACT_UNKNOWN",
                "error": f"unsupported action: {action}",
            },
            9,
        )
    except Exception as e:
        return emit({"ok": False, "code": "AX_ACT_FAILED", "error": str(e)}, 10)


if __name__ == "__main__":
    sys.exit(main())
