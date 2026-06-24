// ApprovalController: holds the queue of dApp requests awaiting explicit user
// consent and opens the extension popup to collect a decision. The popup reads
// the pending list and reports approve/reject back to the background.
//
// Pending promises live in service-worker memory (a scaffold simplification — if
// the worker is torn down mid-approval the dApp request rejects/timeouts; see the
// hardening item in the design doc). A serialized mirror is kept in storage so
// the popup can render the queue.

import { storage } from "wxt/storage";
import { RpcErrors } from "@/src/messaging/protocol";

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
  /** The id of the currently-open approval popup window (if any). */
  private windowId: number | null = null;

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
    // Drop zombie entries: any queued approval with no live resolver belongs to a
    // previous service-worker lifetime (its dApp promise is already dead). Pruning
    // them here means a fresh request always surfaces as the active approval,
    // instead of the stale one wedging the popup (e.g. reconnect after a
    // disconnect spinning until a page refresh).
    const queue = (await queueStore.getValue()).filter((a) => this.resolvers.has(a.id));
    await queueStore.setValue([...queue, approval]);

    const promise = new Promise<T>((resolve, reject) => {
      this.resolvers.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });

    await this.ensurePopup();
    return promise;
  }

  /** Open the approval popup, reusing/focusing an existing one rather than stacking. */
  private async ensurePopup(): Promise<void> {
    if (this.windowId != null) {
      try {
        await browser.windows.update(this.windowId, { focused: true });
        return;
      } catch {
        this.windowId = null; // window was closed since we last opened it
      }
    }
    this.windowId = await openApprovalPopup();
  }

  /**
   * Called when a browser window closes. If it's our approval popup and the user
   * dismissed it without deciding, reject the outstanding requests so the dApp
   * gets a clean "user rejected" instead of hanging forever.
   */
  async onWindowClosed(windowId: number): Promise<void> {
    if (windowId !== this.windowId) return;
    this.windowId = null;
    for (const [, r] of this.resolvers) r.reject(RpcErrors.userRejected);
    this.resolvers.clear();
    await queueStore.setValue([]);
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

async function openApprovalPopup(): Promise<number | null> {
  const url = browser.runtime.getURL("/popup.html#/approve");
  try {
    const win = await browser.windows.create({
      url,
      type: "popup",
      width: 380,
      height: 620,
      focused: true,
    });
    return win?.id ?? null;
  } catch {
    // Fallback: best-effort open of the default action popup.
    try {
      await browser.action.openPopup();
    } catch {
      /* ignore */
    }
    return null;
  }
}

export const approvals = new ApprovalController();
