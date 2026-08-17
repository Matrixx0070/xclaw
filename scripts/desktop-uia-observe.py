#!/usr/bin/env python3
"""XClaw W1 — Windows UI Automation observe → JSON elements (ref, role, name, bbox, cx, cy).

Optional dep: pywinauto
On non-Windows: exits with DESKTOP_OBSERVE_UNSUPPORTED_OS JSON.
"""
from __future__ import annotations

import json
import sys


def emit(obj: dict, code: int = 0) -> int:
    print(json.dumps(obj, ensure_ascii=False))
    return code


def main() -> int:
    if sys.platform != "win32":
        return emit(
            {
                "ok": False,
                "code": "DESKTOP_OBSERVE_UNSUPPORTED_OS",
                "error": f"UIA observe only on Windows (got {sys.platform})",
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

    elements = []
    try:
        desktop = Desktop(backend="uia")
        # Top-level windows
        try:
            windows = desktop.windows()
        except Exception as e:
            return emit(
                {"ok": False, "code": "UIA_DESKTOP_FAILED", "error": str(e)},
                4,
            )

        for win in windows:
            if len(elements) >= max_els:
                break
            try:
                title = (win.window_text() or "").strip()
            except Exception:
                title = ""
            try:
                name = getattr(win.element_info, "name", None) or title
            except Exception:
                name = title
            if app_filter and app_filter.lower() not in (name or "").lower() and app_filter.lower() not in title.lower():
                continue

            def walk(ctrl, depth=0):
                if len(elements) >= max_els or depth > 10:
                    return
                try:
                    info = ctrl.element_info
                    role = str(getattr(info, "control_type", None) or getattr(info, "class_name", "") or "unknown")
                    el_name = (getattr(info, "name", None) or "").strip()[:160]
                    rect = getattr(info, "rectangle", None)
                except Exception:
                    return

                interesting = any(
                    k in role.lower()
                    for k in (
                        "button",
                        "edit",
                        "text",
                        "hyperlink",
                        "checkbox",
                        "radiobutton",
                        "combobox",
                        "listitem",
                        "menuitem",
                        "tabitem",
                        "treeitem",
                        "document",
                    )
                )
                if interesting and (el_name or "button" in role.lower() or "edit" in role.lower()):
                    x = y = w = h = None
                    try:
                        if rect is not None:
                            x, y = int(rect.left), int(rect.top)
                            w, h = int(rect.width()), int(rect.height())
                    except Exception:
                        pass
                    if w is not None and h is not None and w >= 1 and h >= 1:
                        elements.append(
                            {
                                "ref": f"w{len(elements) + 1}",
                                "role": role,
                                "name": el_name or role,
                                "bbox": {"x": x, "y": y, "width": w, "height": h},
                                "cx": int(x + w / 2),
                                "cy": int(y + h / 2),
                                "window": title[:80] if title else None,
                            }
                        )
                try:
                    for child in ctrl.children():
                        walk(child, depth + 1)
                        if len(elements) >= max_els:
                            return
                except Exception:
                    pass

            try:
                walk(win, 0)
            except Exception:
                # still record top-level window as element if named
                if title and len(elements) < max_els:
                    try:
                        r = win.rectangle()
                        elements.append(
                            {
                                "ref": f"w{len(elements) + 1}",
                                "role": "Window",
                                "name": title[:160],
                                "bbox": {
                                    "x": r.left,
                                    "y": r.top,
                                    "width": r.width(),
                                    "height": r.height(),
                                },
                                "cx": int((r.left + r.right) / 2),
                                "cy": int((r.top + r.bottom) / 2),
                            }
                        )
                    except Exception:
                        pass

    except Exception as e:
        return emit({"ok": False, "code": "UIA_WALK_FAILED", "error": str(e)}, 5)

    return emit(
        {
            "ok": True,
            "action": "observe",
            "mode": "uia",
            "engine": "desktop-uia",
            "elementCount": len(elements),
            "elements": elements,
            "notes": "Windows UI Automation via pywinauto; act still requires XCLAW_DESKTOP_GUI=1",
        }
    )


if __name__ == "__main__":
    sys.exit(main())
