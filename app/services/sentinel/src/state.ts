import fs from "fs";

export interface State {
  /** last Cirrus event id scanned */
  lastEventId?: number;
  /** last STRATO block whose transactions were scanned */
  lastTxBlock?: number;
  /** proxy address -> logic contract, from the last snapshot */
  proxies?: Record<string, string>;
  lastProxySnapshotAt?: number;
  /** governed token -> total supply, from the last snapshot */
  supplies?: Record<string, string>;
  lastSupplySnapshotAt?: number;
  /** chain id -> last external block scanned */
  evmBlocks?: Record<string, number>;
}

/** File-backed cursors; each watcher saves only after its alerts were delivered. */
export class StateStore {
  state: State = {};

  constructor(private file: string) {
    try {
      this.state = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      this.state = {};
    }
  }

  save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.state));
  }
}
