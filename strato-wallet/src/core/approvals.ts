// ApprovalController: holds the queue of dApp requests awaiting explicit user
// consent and opens the extension popup to collect a decision. The popup reads
// the pending list and reports approve/reject back to the background.
//
// Pending promises live in service-worker memory (a scaffold simplification — if
// the worker is torn down mid-approval the dApp request rejects/timeouts; see the
// hardening item in the design doc). A serialized mirror is kept in storage so
// the popup can render the queue.

import { storage } from "wxt/storage";

export type ApprovalType =
  | "connect"
  | "signTransaction"
  | "signTypedData"
  | "personalSign"
  | "stratoBlocTx"
  | "addChain"
  | "switchChain";

export interface PendingApproval {
  id: string;
  type: ApprovalType;
  origin: string;
  /** human-renderable request payload */
  data: unknown;
  createdAt: number;
}

interface Resolver {
  resolve: (value: unknown) => void;
  reject: (reason: { code: number; message: string }) => void;
}

const queueStore = storage.defineItem<PendingApproval[]>("local:approvalQueue", {
  fallback: [],
});

class ApprovalController {
  private resolvers = new Map<string, Resolver>();
  private seq = 0;

  async getQueue(): Promise<PendingApproval[]> {
    return queueStore.getValue();
  }

  /** Enqueue an approval, open the popup, and await the user's decision. */
  async request<T = unknown>(
    type: ApprovalType,
    origin: string,
    data: unknown
  ): Promise<T> {
    const id = `${Date.now()}-${this.seq++}`;
    const approval: PendingApproval = {
      id,
      type,
      origin,
      data,
      createdAt: Date.now(),
    };
    const queue = await queueStore.getValue();
    await queueStore.setValue([...queue, approval]);

    const promise = new Promise<T>((resolve, reject) => {
      this.resolvers.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });

    await openApprovalPopup();
    return promise;
  }

  async resolve(id: string, value: unknown): Promise<void> {
    const r = this.resolvers.get(id);
    if (r) {
      r.resolve(value);
      this.resolvers.delete(id);
    }
    await this.dequeue(id);
  }

  async reject(id: string, reason: { code: number; message: string }): Promise<void> {
    const r = this.resolvers.get(id);
    if (r) {
      r.reject(reason);
      this.resolvers.delete(id);
    }
    await this.dequeue(id);
  }

  private async dequeue(id: string): Promise<void> {
    const queue = await queueStore.getValue();
    await queueStore.setValue(queue.filter((a) => a.id !== id));
  }
}

async function openApprovalPopup(): Promise<void> {
  const url = browser.runtime.getURL("/popup.html#/approve");
  try {
    await browser.windows.create({
      url,
      type: "popup",
      width: 380,
      height: 620,
      focused: true,
    });
  } catch {
    // Fallback: best-effort open of the default action popup.
    try {
      await browser.action.openPopup();
    } catch {
      /* ignore */
    }
  }
}

export const approvals = new ApprovalController();
