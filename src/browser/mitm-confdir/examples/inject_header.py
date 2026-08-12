"""
Example custom mitmproxy addon for XClaw.

Merge into addons.py::

    from examples.inject_header import InjectHeader  # or paste class
    addons = [XClawFlows(), XClawEcho(), InjectHeader()]

Or run standalone::

    mitmdump -s inject_header.py -p 4444
"""

from mitmproxy import ctx, http


class InjectHeader:
    def response(self, flow: http.HTTPFlow) -> None:
        if flow.response is None:
            return
        flow.response.headers["X-XClaw-Example"] = "inject_header"
        ctx.log.info(f"injected header on {flow.request.host}{flow.request.path}")


addons = [InjectHeader()]
