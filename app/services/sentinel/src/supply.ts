import { ADMIN_REGISTRY, Config } from "./config";
import { Alert } from "./rules";
import { cirrus } from "./strato";
import { notify } from "./notify";
import { StateStore } from "./state";

const log = (msg: string) => console.log(`${new Date().toISOString()} [supply] ${msg}`);

/** Catches many small mints that each stay under MINT_ALERT_PCT: compare every governed
 *  token's total supply against the previous snapshot. */
export async function snapshotSupply(cfg: Config, store: StateStore): Promise<void> {
  const s = store.state;
  if (s.lastSupplySnapshotAt && Date.now() - s.lastSupplySnapshotAt < cfg.supplySnapshotSeconds * 1000) return;

  const current: Record<string, string> = {};
  for (const table of ["BlockApps-Token", "BlockApps-Voucher"]) {
    for (let offset = 0; ; offset += cfg.pageSize) {
      const rows = await cirrus(cfg, `/${table}`, {
        _owner: `eq.${ADMIN_REGISTRY}`,
        select: "address,_totalSupply",
        order: "address.asc",
        limit: cfg.pageSize,
        offset,
      });
      for (const r of rows) current[r.address] = String(r._totalSupply);
      if (rows.length < cfg.pageSize) break;
    }
  }

  const alerts: Alert[] = [];
  if (s.supplies) {
    for (const [token, supply] of Object.entries(current)) {
      const previous = Number(s.supplies[token]);
      if (!previous) continue; // new or previously empty token
      const pct = ((Number(supply) - previous) / previous) * 100;
      if (pct >= cfg.supplyJumpPct)
        alerts.push({
          severity: "high",
          title: `Supply jump: +${pct.toFixed(1)}% since last snapshot`,
          fields: { token, previousSupply: s.supplies[token], supply, window: `${cfg.supplySnapshotSeconds}s` },
        });
    }
  }

  await notify(cfg, alerts);
  s.supplies = current;
  s.lastSupplySnapshotAt = Date.now();
  store.save();
  log(`snapshot of ${Object.keys(current).length} governed tokens, next in ${cfg.supplySnapshotSeconds}s — ${alerts.length} alert(s)`);
}
