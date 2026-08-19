/**
 * etcd readiness for gateway /ready — not liveness.
 */
import { etcdEnabled } from "./etcd-election.mjs";

export async function etcdReadiness(cfg = {}, { timeoutMs = 1000 } = {}) {
  if (!etcdEnabled(cfg)) return { ok: true, skipped: true };
  const client = cfg.etcd || cfg.etcdClient;
  if (!client) return { ok: false, code: "ETCD_UNAVAILABLE" };
  try {
    const run = async () => {
      if (typeof client.status === "function") return client.status();
      if (typeof client.get === "function") return client.get("/xclaw/coordinator");
      if (typeof client.alarm === "function") return client.alarm();
      return true;
    };
    await Promise.race([
      run(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    return { ok: true, backend: "etcd" };
  } catch (e) {
    return { ok: false, code: "ETCD_ERROR", error: String(e.message || e) };
  }
}

export default { etcdReadiness };
