/**
 * Swarm Metrics — Prometheus-compatible metrics exporter
 */
import { getConfig } from "./config.mjs";

export class SwarmMetrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.enabled = getConfig().swarm.telemetry?.enabled ?? true;
    this.port = getConfig().swarm.telemetry?.prometheusPort || 9090;
  }

  increment(name, labels = {}, value = 1) {
    if (!this.enabled) return;
    const key = this._key(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  gauge(name, labels = {}, value) {
    if (!this.enabled) return;
    const key = this._key(name, labels);
    this.gauges.set(key, value);
  }

  histogram(name, labels = {}, value) {
    if (!this.enabled) return;
    const key = this._key(name, labels);
    if (!this.histograms.has(key)) this.histograms.set(key, []);
    this.histograms.get(key).push(value);
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  getPrometheusFormat() {
    const lines = [];
    for (const [key, value] of this.counters) {
      lines.push(`# TYPE ${key.split("{")[0]} counter`);
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      lines.push(`# TYPE ${key.split("{")[0]} gauge`);
      lines.push(`${key} ${value}`);
    }
    for (const [key, values] of this.histograms) {
      const name = key.split("{")[0];
      lines.push(`# TYPE ${name} histogram`);
      const sum = values.reduce((a, b) => a + b, 0);
      lines.push(`${key}_count ${values.length}`);
      lines.push(`${key}_sum ${sum}`);
    }
    return lines.join("\n");
  }

  async startServer() {
    if (!this.enabled) return;
    const http = await import("http");
    const server = http.createServer((req, res) => {
      if (req.url === "/metrics") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(this.getPrometheusFormat());
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(this.port, () => {
      console.log(`[swarm-metrics] Prometheus metrics on :${this.port}/metrics`);
    });
  }
}

let _metrics = null;
export function getMetrics() {
  if (!_metrics) _metrics = new SwarmMetrics();
  return _metrics;
}
