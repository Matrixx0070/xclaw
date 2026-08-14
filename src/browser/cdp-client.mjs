/**
 * Zero-dep Chrome DevTools Protocol client.
 *
 * Primitive for driving a *user-facing* browser (e.g. the Control browser on
 * display :10) directly over CDP — no bundle, no fabric leases. Used by the
 * point-and-prompt picker; general enough for any future CDP need.
 *
 * Security: loopback hosts only unless opts.allowRemote === true — this
 * client carries no auth and a remote CDP endpoint would be an open door.
 */
import http from "node:http";
import crypto from "node:crypto";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function httpGetJson(host, port, path, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout: timeoutMs }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error(`CDP ${path}: invalid JSON (${e.message})`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("CDP HTTP timeout")));
    req.on("error", reject);
  });
}

/** Minimal RFC6455 client connection (text frames, client-masked). */
function wsConnect(wsUrl, { timeoutMs = 8000 } = {}) {
  const u = new URL(wsUrl);
  const key = crypto.randomBytes(16).toString("base64");
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      timeout: timeoutMs,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
      },
    });
    req.on("timeout", () => req.destroy(new Error("CDP WS timeout")));
    req.on("upgrade", (res, socket) => {
      socket.setNoDelay(true);
      const pending = new Map();
      let id = 0;
      let buf = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 0x80) !== 0;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            off = 10;
          }
          if (buf.length < off + len) return;
          const payload = buf.slice(off, off + len);
          buf = buf.slice(off + len);
          if (op === 8) {
            socket.destroy();
            return;
          }
          if (op === 1 && fin) {
            try {
              const msg = JSON.parse(payload.toString("utf8"));
              if (msg.id && pending.has(msg.id)) {
                const { resolve: res2, reject: rej2 } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) rej2(new Error(msg.error.message || "CDP error"));
                else res2(msg.result);
              }
            } catch {
              /* non-JSON frame ignored */
            }
          }
        }
      });
      socket.on("error", () => {
        for (const { reject: rej2 } of pending.values()) rej2(new Error("CDP socket error"));
        pending.clear();
      });
      function send(method, params = {}, { timeoutMs: t = 15_000 } = {}) {
        const mid = ++id;
        const data = Buffer.from(JSON.stringify({ id: mid, method, params }));
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(data);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        let header;
        if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
        else if (data.length < 65536) {
          header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 0x80 | 126;
          header.writeUInt16BE(data.length, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81;
          header[1] = 0x80 | 127;
          header.writeBigUInt64BE(BigInt(data.length), 2);
        }
        socket.write(Buffer.concat([header, mask, masked]));
        return new Promise((res2, rej2) => {
          pending.set(mid, { resolve: res2, reject: rej2 });
          setTimeout(() => {
            if (pending.has(mid)) {
              pending.delete(mid);
              rej2(new Error(`CDP ${method} timed out`));
            }
          }, t).unref?.();
        });
      }
      resolve({ send, close: () => socket.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * @param {{ host?: string, port?: number, allowRemote?: boolean }} opts
 */
export function createCdpClient(opts = {}) {
  const host = String(opts.host || "127.0.0.1");
  const port = Number(opts.port || 9222);
  if (!LOOPBACK.has(host) && opts.allowRemote !== true) {
    throw new Error(`CDP host ${host} is not loopback (set allowRemote to override)`);
  }

  return {
    host,
    port,

    /** @returns {Promise<Array<{id,type,url,title,webSocketDebuggerUrl}>>} */
    async listPages() {
      const targets = await httpGetJson(host, port, "/json/list");
      return (Array.isArray(targets) ? targets : []).filter((t) => t.type === "page");
    },

    /** Open a new tab (modern Chrome requires PUT /json/new). */
    async newPage(url) {
      const q = url ? `?${encodeURIComponent(url)}` : "";
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host, port, path: `/json/new${q}`, method: "PUT", timeout: 5000 },
          (r) => {
            let d = "";
            r.on("data", (c) => (d += c));
            r.on("end", () => {
              try {
                resolve(JSON.parse(d));
              } catch (e) {
                reject(new Error(`CDP /json/new: ${e.message}`));
              }
            });
          }
        );
        req.on("timeout", () => req.destroy(new Error("CDP /json/new timeout")));
        req.on("error", reject);
        req.end();
      });
    },

    /**
     * Attach to a page (by predicate, url substring, or the first page).
     * @returns {Promise<{page, evaluate, navigate, screenshot, close}>}
     */
    async attach(match) {
      const pages = await this.listPages();
      let page = null;
      if (typeof match === "function") page = pages.find(match);
      else if (typeof match === "string" && match) page = pages.find((p) => String(p.url || "").includes(match));
      if (!page) page = pages[0];
      if (!page) throw new Error("no CDP page target available");
      const ws = await wsConnect(page.webSocketDebuggerUrl);
      return {
        page,
        /** Raw CDP command access for advanced callers (Input.*, DOM.*, …). */
        send: (method, params, opts) => ws.send(method, params, opts),
        async evaluate(expression, { awaitPromise = true, timeoutMs } = {}) {
          const r = await ws.send(
            "Runtime.evaluate",
            { expression, returnByValue: true, awaitPromise },
            timeoutMs ? { timeoutMs } : {}
          );
          if (r?.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
          }
          return r?.result?.value;
        },
        async navigate(url) {
          await ws.send("Page.enable");
          await ws.send("Page.navigate", { url });
        },
        async screenshot() {
          const r = await ws.send("Page.captureScreenshot", { format: "png" });
          return Buffer.from(r.data, "base64");
        },
        close() {
          ws.close();
        },
      };
    },
  };
}
