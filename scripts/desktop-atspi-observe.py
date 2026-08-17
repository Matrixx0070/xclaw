#!/usr/bin/env python3
"""XClaw I5b — AT-SPI desktop observe → JSON elements (ref, role, name, bbox).
Optional dep: python3-pyatspi / gi.repository.Atspi
Exit 0 with JSON on stdout; non-zero + message on stderr if unavailable.
"""
import json
import sys

def main():
    max_els = 40
    app_filter = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--max" and i + 1 < len(args):
            max_els = int(args[i + 1]); i += 2
        elif args[i] == "--app" and i + 1 < len(args):
            app_filter = args[i + 1]; i += 2
        else:
            i += 1

    try:
        import pyatspi
    except ImportError:
        try:
            import gi
            gi.require_version("Atspi", "2.0")
            from gi.repository import Atspi
            # minimal gi path — prefer pyatspi
            raise ImportError("prefer pyatspi")
        except Exception as e:
            print(json.dumps({
                "ok": False,
                "code": "ATSPI_NOT_INSTALLED",
                "error": "pyatspi/Atspi not available: " + str(e),
            }))
            return 2

    elements = []
    try:
        desktop = pyatspi.Registry.getDesktop(0)
    except Exception as e:
        print(json.dumps({"ok": False, "code": "ATSPI_REGISTRY_FAILED", "error": str(e)}))
        return 3

    def walk(acc, depth=0):
        if len(elements) >= max_els or depth > 12:
            return
        try:
            role = acc.getRoleName() if hasattr(acc, "getRoleName") else str(getattr(acc, "role", ""))
            name = (acc.name or "").strip()[:160]
        except Exception:
            return
        interesting = role in (
            "push button", "button", "toggle button", "check box", "radio button",
            "text", "entry", "password text", "combo box", "link", "menu item",
            "tab", "heading", "list item", "table cell",
        ) or (name and role in ("label", "panel", "frame", "window"))
        if interesting and (name or role in ("push button", "button", "entry", "text")):
            x = y = w = h = None
            try:
                comp = acc.queryComponent()
                ext = comp.getExtents(pyatspi.DESKTOP_COORDS)
                x, y, w, h = ext.x, ext.y, ext.width, ext.height
            except Exception:
                pass
            if w is not None and h is not None and w >= 1 and h >= 1:
                elements.append({
                    "ref": "d%d" % (len(elements) + 1),
                    "role": role,
                    "name": name or role,
                    "bbox": {"x": x, "y": y, "width": w, "height": h},
                    "cx": int(x + w / 2),
                    "cy": int(y + h / 2),
                })
        try:
            for i in range(acc.childCount):
                walk(acc.getChildAtIndex(i), depth + 1)
                if len(elements) >= max_els:
                    return
        except Exception:
            pass

    try:
        for app in desktop:
            try:
                an = (app.name or "")
            except Exception:
                continue
            if app_filter and app_filter.lower() not in an.lower():
                continue
            walk(app, 0)
            if len(elements) >= max_els:
                break
    except Exception as e:
        print(json.dumps({"ok": False, "code": "ATSPI_WALK_FAILED", "error": str(e)}))
        return 4

    print(json.dumps({
        "ok": True,
        "action": "observe",
        "mode": "atspi",
        "engine": "desktop-atspi",
        "elementCount": len(elements),
        "elements": elements,
        "notes": "Linux AT-SPI tree; click via surface=desktop with x,y from cx,cy or ref after cache",
    }))
    return 0

if __name__ == "__main__":
    sys.exit(main())
