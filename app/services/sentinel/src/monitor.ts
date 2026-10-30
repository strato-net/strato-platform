import { Config } from "./config";
import { StateStore } from "./state";
import { scanEvents } from "./events";
import { snapshotProxies } from "./proxies";
import { snapshotSupply } from "./supply";
import { scanTxs } from "./txs";
import { scanEvm } from "./evm";

const log = (msg: string) => console.log(`${new Date().toISOString()} [monitor] ${msg}`);

const WATCHERS: [string, (cfg: Config, store: StateStore) => Promise<void>][] = [
  ["events", scanEvents],
  ["proxies", snapshotProxies],
  ["supply", snapshotSupply],
  ["txs", scanTxs],
  ["evm", scanEvm],
];

/** Runs every watcher each cycle; one failing watcher never blocks the others. */
export class Monitor {
  lastCycleAt?: number;
  errors: Record<string, string> = {};

  constructor(private cfg: Config, readonly store: StateStore) {}

  get healthy(): boolean {
    const staleMs = this.cfg.pollIntervalSeconds * 1000 * 5;
    return Object.keys(this.errors).length === 0 && !!this.lastCycleAt && Date.now() - this.lastCycleAt < staleMs;
  }

  async runCycle(): Promise<void> {
    for (const [name, watch] of WATCHERS) {
      try {
        await watch(this.cfg, this.store);
        delete this.errors[name];
      } catch (err: any) {
        this.errors[name] = err.message || String(err);
        log(`${name} failed: ${this.errors[name]}`);
      }
    }
    this.lastCycleAt = Date.now();
  }
}
