/**
 * Zero-dep Chrome DevTools Protocol client.
 *
 * Primitive for driving a *user-facing* browser (e.g. the Control browser on
 * display :10) directly over CDP — no bundle, no fabric leases. Used by the
 * point-and-prompt picker; general enough for any future CDP need.
 *
 * Security: loopback hosts only unless opts.allowRemote === true — this
 * client carries no auth and a remote CDP endpoint would be an open door.
 *
 * WebSocket control frames: opcode 9 (ping) auto-replies with 10 (pong);
 * session.ping() sends a client ping (optional wait for pong).
 *
 * Robustness layers:
 *   1) TCP keepalive (socket.setKeepAlive) — half-open / silent path death
 *   2) WS ping/pong — framing liveness
 *   3) Optional periodic heartbeat (startHeartbeat) — app-driven keepalive
 *   4) Pending request fail-fast on socket close/error
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

/**
 * Minimal RFC6455 client connection (text frames, client-masked).
 * @param {string} wsUrl
 * @param {{
 *   timeoutMs?: number,
 *   keepAlive?: boolean,
 *   keepAliveInitialDelayMs?: number,
 *   heartbeatIntervalMs?: number,
 *   heartbeatTimeoutMs?: number,
 *   onDisconnect?: (err?: Error) => void,
 * }} [opts]
 */
function wsConnect(wsUrl, opts = {}) {
  const {
    timeoutMs = 8000,
    keepAlive = true,
    keepAliveInitialDelayMs = 30_000,
    heartbeatIntervalMs = 0,
    heartbeatTimeoutMs = 5_000,
    onDisconnect = null,
  } = opts;
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
      // TCP keepalive: detect half-open after idle (layer under WS ping)
      if (keepAlive !== false) {
        try {
          socket.setKeepAlive(true, Math.max(0, Number(keepAliveInitialDelayMs) || 30_000));
        } catch {
          /* platform may ignore */
        }
      }
      const pending = new Map();
      let id = 0;
      let buf = Buffer.alloc(0);
      let closed = false;
      /** @type {ReturnType<typeof setInterval> | null} */
      let heartbeatTimer = null;
      /** @type {((payload: Buffer) => void) | null} */
      let onPong = null;

      function failPending(err) {
        const e = err instanceof Error ? err : new Error(String(err || "CDP socket closed"));
        for (const { reject: rej2 } of pending.values()) {
          try {
            rej2(e);
          } catch {
            /* ignore */
          }
        }
        pending.clear();
      }

      function markClosed(err) {
        if (closed) return;
        closed = true;
        stopHeartbeat();
        failPending(err || new Error("CDP socket closed"));
        try {
          onDisconnect?.(err instanceof Error ? err : err ? new Error(String(err)) : undefined);
        } catch {
          /* listener must not throw outward */
        }
      }

      /**
       * Write a masked client frame (RFC6455 §5.3).
       * @param {number} opcode 1=text 8=close 9=ping 10=pong
       * @param {Buffer} [payload]
       */
      function writeFrame(opcode, payload = Buffer.alloc(0)) {
        if (closed || socket.destroyed) {
          throw new Error("CDP socket closed");
        }
        const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(data);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        let header;
        // FIN=1, opcode in low nibble; MASK=1 on all client frames
        const b0 = 0x80 | (opcode & 0x0f);
        if (data.length < 126) {
          header = Buffer.from([b0, 0x80 | data.length]);
        } else if (data.length < 65536) {
          header = Buffer.alloc(4);
          header[0] = b0;
          header[1] = 0x80 | 126;
          header.writeUInt16BE(data.length, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = b0;
          header[1] = 0x80 | 127;
          header.writeBigUInt64BE(BigInt(data.length), 2);
        }
        socket.write(Buffer.concat([header, mask, masked]));
      }

      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 0x80) !== 0;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          // Server→client: MASK should be 0; if set, skip 4-byte mask after header
          const masked = (buf[1] & 0x80) !== 0;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            off = 10;
          }
          const maskLen = masked ? 4 : 0;
          if (buf.length < off + maskLen + len) return;
          let payload = buf.slice(off + maskLen, off + maskLen + len);
          if (masked) {
            const mkey = buf.slice(off, off + 4);
            payload = Buffer.from(payload);
            for (let i = 0; i < payload.length; i++) payload[i] ^= mkey[i % 4];
          }
          buf = buf.slice(off + maskLen + len);

          // 8 = close
          if (op === 8) {
            try {
              if (!closed) writeFrame(8, payload.length ? payload : Buffer.alloc(0));
            } catch {
              /* socket may already be closing */
            }
            markClosed(new Error("CDP peer closed WebSocket"));
            socket.destroy();
            return;
          }
          // 9 = ping → reply with pong, same application data (RFC6455 §5.5.2)
          if (op === 9) {
            try {
              writeFrame(10, payload);
            } catch {
              /* ignore write errors on dead socket */
            }
            continue;
          }
          // 10 = pong (response to our ping, or unsolicited)
          if (op === 10) {
            try {
              onPong?.(payload);
            } catch {
              /* listener errors must not break the parser */
            }
            continue;
          }
          // 1 = text (CDP JSON)
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
      socket.on("error", (err) => {
        markClosed(err || new Error("CDP socket error"));
      });
      socket.on("close", () => {
        markClosed(new Error("CDP socket closed"));
      });
      socket.on("end", () => {
        markClosed(new Error("CDP socket ended"));
      });

      function send(method, params = {}, { timeoutMs: t = 15_000 } = {}) {
        if (closed) return Promise.reject(new Error("CDP socket closed"));
        const mid = ++id;
        const data = Buffer.from(JSON.stringify({ id: mid, method, params }));
        try {
          writeFrame(1, data);
        } catch (e) {
          return Promise.reject(e);
        }
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

      /**
       * Send a WebSocket ping; optional wait for matching pong.
       * @param {Buffer|string} [payload]
       * @param {{ wait?: boolean, timeoutMs?: number }} [opts]
       */
      function ping(payload = Buffer.alloc(0), opts = {}) {
        if (closed) return Promise.reject(new Error("CDP socket closed"));
        const data = Buffer.isBuffer(payload)
          ? payload
          : Buffer.from(String(payload || ""), "utf8");
        const body = data.length > 125 ? data.subarray(0, 125) : data;
        try {
          writeFrame(9, body);
        } catch (e) {
          return Promise.reject(e);
        }
        if (!opts.wait) return Promise.resolve();
        const waitMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 5000;
        return new Promise((res2, rej2) => {
          const prev = onPong;
          const timer = setTimeout(() => {
            onPong = prev;
            rej2(new Error("CDP WebSocket ping timed out"));
          }, waitMs);
          timer.unref?.();
          onPong = (pongPayload) => {
            onPong = prev;
            clearTimeout(timer);
            res2(pongPayload);
            try {
              prev?.(pongPayload);
            } catch {
              /* ignore */
            }
          };
        });
      }

      function stopHeartbeat() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }

      /**
       * Periodic WS ping (application heartbeat on top of TCP keepalive).
       * @param {{ intervalMs?: number, timeoutMs?: number, onMiss?: (err: Error) => void }} [hbOpts]
       */
      function startHeartbeat(hbOpts = {}) {
        stopHeartbeat();
        const interval = Number(hbOpts.intervalMs) > 0
          ? Number(hbOpts.intervalMs)
          : Number(heartbeatIntervalMs) > 0
            ? Number(heartbeatIntervalMs)
            : 30_000;
        const waitMs = Number(hbOpts.timeoutMs) > 0
          ? Number(hbOpts.timeoutMs)
          : Number(heartbeatTimeoutMs) || 5_000;
        const onMiss = hbOpts.onMiss || ((err) => markClosed(err));
        heartbeatTimer = setInterval(() => {
          if (closed) {
            stopHeartbeat();
            return;
          }
          ping("xclaw-hb", { wait: true, timeoutMs: waitMs }).catch((err) => {
            try {
              onMiss(err instanceof Error ? err : new Error(String(err)));
            } catch {
              /* ignore */
            }
          });
        }, interval);
        heartbeatTimer.unref?.();
        return () => stopHeartbeat();
      }

      // Auto-start heartbeat when interval configured at connect
      if (Number(heartbeatIntervalMs) > 0) {
        startHeartbeat({
          intervalMs: heartbeatIntervalMs,
          timeoutMs: heartbeatTimeoutMs,
        });
      }

      resolve({
        send,
        ping,
        startHeartbeat,
        stopHeartbeat,
        isOpen: () => !closed && !socket.destroyed,
        close: () => {
          stopHeartbeat();
          if (!closed) {
            try {
              writeFrame(8, Buffer.alloc(0));
            } catch {
              /* ignore */
            }
          }
          markClosed(new Error("CDP socket closed by client"));
          socket.destroy();
        },
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * @param {{
 *   host?: string,
 *   port?: number,
 *   allowRemote?: boolean,
 *   keepAlive?: boolean,
 *   keepAliveInitialDelayMs?: number,
 *   heartbeatIntervalMs?: number,
 *   heartbeatTimeoutMs?: number,
 * }} opts
 */
export function createCdpClient(opts = {}) {
  const host = String(opts.host || "127.0.0.1");
  const port = Number(opts.port || 9222);
  if (!LOOPBACK.has(host) && opts.allowRemote !== true) {
    throw new Error(`CDP host ${host} is not loopback (set allowRemote to override)`);
  }
  const wsOpts = {
    keepAlive: opts.keepAlive !== false,
    keepAliveInitialDelayMs: opts.keepAliveInitialDelayMs ?? 30_000,
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 0,
    heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 5_000,
  };

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
     * @returns {Promise<{page, send, ping, evaluate, navigate, screenshot, close}>}
     */
    async attach(match) {
      const pages = await this.listPages();
      let page = null;
      if (typeof match === "function") page = pages.find(match);
      else if (typeof match === "string" && match) page = pages.find((p) => String(p.url || "").includes(match));
      if (!page) page = pages[0];
      if (!page) throw new Error("no CDP page target available");
      const ws = await wsConnect(page.webSocketDebuggerUrl, wsOpts);
      return {
        page,
        /** Raw CDP command access for advanced callers (Input.*, DOM.*, …). */
        send: (method, params, sendOpts) => ws.send(method, params, sendOpts),
        /** WebSocket-level ping (not a CDP domain method). */
        ping: (payload, pingOpts) => ws.ping(payload, pingOpts),
        startHeartbeat: (hbOpts) => ws.startHeartbeat(hbOpts),
        stopHeartbeat: () => ws.stopHeartbeat(),
        isOpen: () => ws.isOpen(),
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
