import React from "react";
import type { Address } from "viem";
import { callBackground } from "@/src/messaging/control";
import type { PendingApproval } from "@/src/core/approvals";
import type { AccountMeta } from "@/src/core/keyring";
import { Button, Card, Header, shortAddr } from "./components";
import { useAsync, useHashRoute } from "./hooks";
import {
  Home,
  Send,
  SwapScreen,
  Receive,
  BridgeHistory,
  Notifications,
  TokenDetails,
  Setup,
  Unlock,
  ImportAccount,
  AccountsList,
  Settings,
} from "./screens";

interface WalletState {
  initialized: boolean;
  unlocked: boolean;
}

export function App() {
  const [route, navigate] = useHashRoute();
  const state = useAsync<WalletState>(async () => ({
    initialized: await callBackground<boolean>("wallet.isInitialized"),
    unlocked: await callBackground<boolean>("wallet.isUnlocked"),
  }));
  const queue = useAsync<PendingApproval[]>(() => callBackground("approvals.queue"));

  if (state.loading) {
    return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>;
  }

  const s = state.data!;

  // First run: create or import a wallet.
  if (!s.initialized) {
    return <Setup onDone={() => state.refresh()} />;
  }

  // Locked: must unlock before anything else.
  if (!s.unlocked) {
    return <Unlock onUnlocked={() => state.refresh()} />;
  }

  // Pending dApp approval takes priority (e.g. opened in the approval popup).
  if ((route === "approve" || (queue.data?.length ?? 0) > 0) && queue.data?.length) {
    return (
      <Approve
        approval={queue.data[0]}
        onDone={() => {
          queue.refresh();
          // Close the standalone approval window once the queue drains.
          callBackground<PendingApproval[]>("approvals.queue").then((q) => {
            if (!q.length && route === "approve") window.close();
          });
        }}
      />
    );
  }

  // Token details: route is "token/<address>".
  if (route.startsWith("token/")) {
    return <TokenDetails address={route.slice("token/".length)} navigate={navigate} />;
  }

  switch (route) {
    case "send":
      return <Send navigate={navigate} />;
    case "swap":
      return <SwapScreen navigate={navigate} />;
    case "receive":
      return <Receive navigate={navigate} />;
    case "bridges":
      return <BridgeHistory navigate={navigate} />;
    case "notifications":
      return <Notifications navigate={navigate} />;
    case "accounts":
      return <AccountsList navigate={navigate} />;
    case "import":
      return <ImportAccount navigate={navigate} />;
    case "settings":
      return <Settings navigate={navigate} />;
    default:
      return <Home navigate={navigate} />;
  }
}

// ------------------------------------------------------------------ Approve
function Approve({ approval, onDone }: { approval: PendingApproval; onDone: () => void }) {
  const accounts = useAsync<AccountMeta[]>(() => callBackground("accounts.list"));
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const [busy, setBusy] = React.useState(false);
  const [chosen, setChosen] = React.useState<Address | null>(null);

  // Default the connect picker to the active account once both loads resolve.
  React.useEffect(() => {
    if (chosen === null && selected.data) setChosen(selected.data);
  }, [selected.data, chosen]);

  const isConnect = approval.type === "connect";
  const activeForRequest = isConnect ? chosen : selected.data;

  const approve = async () => {
    setBusy(true);
    try {
      if (isConnect) {
        const addr = chosen ?? selected.data ?? accounts.data?.[0]?.address;
        // Make the chosen account the active one so the wallet UI stays in sync,
        // then grant it to the site (the resolved value is the account list).
        if (addr) await callBackground("accounts.select", addr);
        await callBackground("approvals.resolve", approval.id, [addr]);
      } else {
        await callBackground("approvals.resolve", approval.id, true);
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);
    try {
      await callBackground("approvals.reject", approval.id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Header title="Confirm request" />
      <div className="space-y-3 p-4">
        <p className="text-xs text-slate-500">
          From <span className="font-medium text-slate-700">{approval.origin}</span>
        </p>
        <Card className="space-y-2">
          <p className="text-sm font-semibold">{titleFor(approval.type)}</p>
          {isConnect ? (
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Connect with account:</p>
              {(accounts.data ?? []).map((a) => (
                <button
                  key={a.address}
                  onClick={() => setChosen(a.address)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                    a.address.toLowerCase() === (activeForRequest ?? "").toLowerCase()
                      ? "border-[#001B70] bg-blue-50"
                      : "border-slate-200"
                  }`}
                >
                  <span>
                    <span className="font-medium">{a.label}</span>{" "}
                    <span className="text-xs text-slate-400">({a.kind})</span>
                  </span>
                  <span className="font-mono text-xs">{shortAddr(a.address)}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500">Account: {shortAddr(activeForRequest)}</p>
              <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                {JSON.stringify(approval.data, jsonSafe, 2)}
              </pre>
            </>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={busy} onClick={reject}>
            Reject
          </Button>
          <Button disabled={busy} onClick={approve}>
            {approval.type === "connect" ? "Connect" : "Approve"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function titleFor(type: PendingApproval["type"]): string {
  return {
    connect: "Connect this site",
    signTransaction: "Confirm transaction",
    signTypedData: "Sign typed data",
    personalSign: "Sign message",
    stratoBlocTx: "Confirm STRATO transaction",
    addChain: "Add network",
    switchChain: "Switch network",
  }[type];
}

// BigInt-safe JSON rendering for the approval payload.
function jsonSafe(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
