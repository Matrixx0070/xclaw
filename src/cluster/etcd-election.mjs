/**
 * etcd election adapter skeleton.
 */
export function etcdEnabled(cfg = {}) {
  return (
    process.env.XCLAW_CLUSTER_ELECTION === "etcd" ||
    cfg?.cluster?.election === "etcd"
  );
}

export async function campaign(cfg = {}, { owner = null, ttlMs = 15_000 } = {}) {
  const client = cfg.etcd || cfg.etcdClient;
  const id = owner || `gw-${process.pid}`;
  if (!client) {
    return { ok: false, code: "ETCD_UNAVAILABLE", reason: "no_client" };
  }
  try {
    if (typeof client.campaign !== "function" && typeof client.put !== "function") {
      return { ok: false, code: "ETCD_UNAVAILABLE", reason: "no_api" };
    }
    if (typeof client.campaign === "function") {
      await client.campaign("/xclaw/coordinator", id, ttlMs);
    } else {
      await client.put("/xclaw/coordinator", id);
    }
    return { ok: true, owner: id, backend: "etcd" };
  } catch (e) {
    return { ok: false, code: "ETCD_ERROR", error: String(e.message || e) };
  }
}

export async function resign(cfg = {}) {
  const client = cfg.etcd || cfg.etcdClient;
  if (!client) return { ok: false, code: "ETCD_UNAVAILABLE" };
  try {
    if (typeof client.resign === "function") await client.resign();
    else if (typeof client.delete === "function") await client.delete("/xclaw/coordinator");
    return { ok: true, backend: "etcd" };
  } catch (e) {
    return { ok: false, code: "ETCD_ERROR", error: String(e.message || e) };
  }
}

export default { campaign, resign, etcdEnabled };
