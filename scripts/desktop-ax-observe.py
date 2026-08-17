#!/usr/bin/env python3
"""XClaw M1 — macOS Accessibility (AXUIElement) observe → JSON elements.

Optional deps: pyobjc-framework-ApplicationServices / Cocoa (pyobjc)
On non-macOS: DESKTOP_OBSERVE_UNSUPPORTED_OS.
Requires Accessibility permission for the hosting process when run on macOS.
"""
from __future__ import annotations

import json
import sys


def emit(obj: dict, code: int = 0) -> int:
    print(json.dumps(obj, ensure_ascii=False))
    return code


def main() -> int:
    if sys.platform != "darwin":
        return emit(
            {
                "ok": False,
                "code": "DESKTOP_OBSERVE_UNSUPPORTED_OS",
                "error": f"AX observe only on macOS (got {sys.platform})",
                "platform": sys.platform,
            },
            2,
        )

    max_els = 40
    app_filter = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--max" and i + 1 < len(args):
            max_els = int(args[i + 1])
            i += 2
        elif args[i] == "--app" and i + 1 < len(args):
            app_filter = args[i + 1]
            i += 2
        else:
            i += 1

    try:
        from ApplicationServices import (
            AXUIElementCreateSystemWide,
            AXUIElementCopyAttributeValue,
            AXUIElementCopyAttributeNames,
            kAXErrorSuccess,
            kAXRoleAttribute,
            kAXTitleAttribute,
            kAXValueAttribute,
            kAXChildrenAttribute,
            kAXPositionAttribute,
            kAXSizeAttribute,
            kAXEnabledAttribute,
            AXIsProcessTrusted,
        )
        from Cocoa import NSWorkspace
    except ImportError as e:
        return emit(
            {
                "ok": False,
                "code": "AX_NOT_INSTALLED",
                "error": f"pyobjc ApplicationServices/Cocoa not available: {e}",
                "hint": "pip install pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa",
            },
            3,
        )

    if not AXIsProcessTrusted():
        return emit(
            {
                "ok": False,
                "code": "AX_TCC_REQUIRED",
                "error": "Accessibility permission not granted for this process",
                "hint": "System Settings → Privacy & Security → Accessibility",
            },
            4,
        )

    def ax_get(el, attr):
        err, val = AXUIElementCopyAttributeValue(el, attr, None)
        if err != kAXErrorSuccess:
            return None
        return val

    def ax_pos_size(el):
        pos = ax_get(el, kAXPositionAttribute)
        size = ax_get(el, kAXSizeAttribute)
        if pos is None or size is None:
            return None
        try:
            # AXValue → unpack via Cocoa if needed; pyobjc often gives dict-like or CGPoint
            x = float(getattr(pos, "x", None) if hasattr(pos, "x") else pos[0])
            y = float(getattr(pos, "y", None) if hasattr(pos, "y") else pos[1])
            w = float(getattr(size, "width", None) if hasattr(size, "width") else size[0])
            h = float(getattr(size, "height", None) if hasattr(size, "height") else size[1])
            return x, y, w, h
        except Exception:
            try:
                # CFType AXValue bridge sometimes needs AXValueGetValue — skip if opaque
                return None
            except Exception:
                return None

    INTERESTING = {
        "AXButton",
        "AXCheckBox",
        "AXRadioButton",
        "AXTextField",
        "AXTextArea",
        "AXComboBox",
        "AXLink",
        "AXMenuItem",
        "AXPopUpButton",
        "AXTab",
        "AXSlider",
        "AXStaticText",
    }

    elements = []

    def walk(el, depth=0, window_title=None):
        if len(elements) >= max_els or depth > 12:
            return
        role = ax_get(el, kAXRoleAttribute) or ""
        title = ax_get(el, kAXTitleAttribute) or ""
        value = ax_get(el, kAXValueAttribute)
        name = (title or (str(value) if value is not None else "") or "").strip()[:160]
        if role in INTERESTING and (name or role in ("AXButton", "AXTextField", "AXTextArea")):
            box = ax_pos_size(el)
            if box:
                x, y, w, h = box
                if w >= 1 and h >= 1:
                    elements.append(
                        {
                            "ref": f"a{len(elements) + 1}",
                            "role": role,
                            "name": name or role,
                            "bbox": {"x": int(x), "y": int(y), "width": int(w), "height": int(h)},
                            "cx": int(x + w / 2),
                            "cy": int(y + h / 2),
                            "window": window_title,
                        }
                    )
        children = ax_get(el, kAXChildrenAttribute) or []
        try:
            for ch in children:
                walk(ch, depth + 1, window_title)
                if len(elements) >= max_els:
                    return
        except Exception:
            pass

    try:
        workspace = NSWorkspace.sharedWorkspace()
        apps = workspace.runningApplications()
        for app in apps:
            try:
                aname = app.localizedName() or ""
            except Exception:
                aname = ""
            if app_filter and app_filter.lower() not in aname.lower():
                continue
            if app.isHidden() and not app_filter:
                continue
            pid = app.processIdentifier()
            try:
                from ApplicationServices import AXUIElementCreateApplication

                app_el = AXUIElementCreateApplication(pid)
            except Exception:
                continue
            # windows
            try:
                from ApplicationServices import kAXWindowsAttribute

                wins = ax_get(app_el, kAXWindowsAttribute) or []
            except Exception:
                wins = []
            if not wins:
                walk(app_el, 0, aname)
            else:
                for w in wins:
                    wtitle = ax_get(w, kAXTitleAttribute) or aname
                    walk(w, 0, str(wtitle)[:80] if wtitle else aname)
            if len(elements) >= max_els:
                break
    except Exception as e:
        return emit({"ok": False, "code": "AX_WALK_FAILED", "error": str(e)}, 5)

    return emit(
        {
            "ok": True,
            "action": "observe",
            "mode": "ax",
            "engine": "desktop-ax",
            "elementCount": len(elements),
            "elements": elements,
            "notes": "macOS AXUIElement via pyobjc; requires Accessibility TCC; act deferred (M2)",
        }
    )


if __name__ == "__main__":
    sys.exit(main())
