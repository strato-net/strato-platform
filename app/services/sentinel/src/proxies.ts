import { ADMIN_REGISTRY, Config, normalize } from "./config";
import { Alert } from "./rules";
import { cirrus } from "./strato";
import { notify } from "./notify";
import { StateStore } from "./state";

const log = (msg: string) => console.log(`${new Date().toISOString()} [proxies] ${msg}`);

interface ProxyRow {
  address: string;
  _owner: string;
  logicContract: string;
}

/** Was this exact logic set through an AdminRegistry setLogicContract call? */
async function viaGovernance(cfg: Config, proxy: string, logic: string): Promise<boolean> {
  const [last] = await cirrus(cfg, "/event", {
    address: `eq.${ADMIN_REGISTRY}`,
    event_name: "eq.IssueExecuted",
    "attributes->>func": "eq.setLogicContract",
    "attributes->>target": `eq.${proxy}`,
    order: "id.desc",
    limit: 1,
    select: "attributes",
  });
  if (!last) return false;
  const [newLogic] = JSON.parse(last.attributes.args || "[]");
  return typeof newLogic === "string" && normalize(newLogic) === logic;
}

/** setLogicContract emits no event, so diff every proxy's logic against the last snapshot. */
export async function snapshotProxies(cfg: Config, store: StateStore): Promise<void> {
  const s = store.state;
  if (s.lastProxySnapshotAt && Date.now() - s.lastProxySnapshotAt < cfg.proxySnapshotSeconds * 1000) return;

  // Cirrus can return the same proxy twice; rows are identical, so the map dedupes them
  const current = new Map<string, ProxyRow>();
  for (let offset = 0; ; offset += cfg.pageSize) {
    const rows = await cirrus<ProxyRow>(cfg, "/BlockApps-Proxy", {
      select: "address,_owner,logicContract",
      order: "address.asc",
      limit: cfg.pageSize,
      offset,
    });
    for (const r of rows) current.set(r.address, r);
    if (rows.length < cfg.pageSize) break;
  }

  const alerts: Alert[] = [];
  if (s.proxies) {
    for (const p of current.values()) {
      const previous = s.proxies[p.address];
      if (previous === undefined || previous === p.logicContract) continue;
      const fields = { proxy: p.address, owner: p._owner, previousLogic: previous, newLogic: p.logicContract };
      if (await viaGovernance(cfg, p.address, p.logicContract))
        alerts.push({ severity: "info", title: "Proxy upgraded through governance", fields });
      else if (p._owner === ADMIN_REGISTRY)
        alerts.push({ severity: "critical", title: "Proxy logic changed without a governance call", fields });
      else alerts.push({ severity: "high", title: "Proxy logic changed by its owner", fields });
    }
  }

  await notify(cfg, alerts);
  s.proxies = Object.fromEntries([...current.values()].map((p) => [p.address, p.logicContract]));
  s.lastProxySnapshotAt = Date.now();
  store.save();
  log(`snapshot of ${current.size} proxies, next in ${cfg.proxySnapshotSeconds}s — ${alerts.length} alert(s)`);
}
