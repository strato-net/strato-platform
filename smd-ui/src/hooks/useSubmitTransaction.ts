import { useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useUser } from "@/context/UserContext";
import { submitStratoTx } from "@/services/contracts";
import { signAndSubmitViaWallet, type StratoTxType } from "@/lib/walletTx";
import { ensureStratoChainInWallet } from "@/lib/stratoChain";

/**
 * Returns a `submit(type, payload)` that routes a STRATO transaction to the right signer:
 * - STRATO session (vault key)  -> POST /strato/v2.3/transaction (server-side signing)
 * - external wallet (no session) -> bloc unsigned tx + walletClient.signTypedData + submit
 */
export function useSubmitTransaction() {
  const { isAppAuthenticated } = useUser();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const submit = useCallback(
    async (
      type: StratoTxType,
      payload: Record<string, unknown>,
      options?: { username?: string }
    ) => {
      const username = options?.username?.trim() || undefined;
      if (isAppAuthenticated) {
        return submitStratoTx(type, payload, username);
      }
      // External-wallet (EIP-712) signing only supports MessageTX-style txs on the
      // node. A raw contract creation can't be signed by an external wallet, but a
      // deploy routed through the user's on-chain User wallet contract becomes a
      // `createContract` function call (a MessageTX) — so it requires a username.
      if (type === "CONTRACT" && !username) {
        throw new Error(
          'Deploying with an external wallet requires a username and "Use Wallet" enabled, ' +
            "so the deploy is routed through your STRATO User wallet contract."
        );
      }
      if (walletClient && address) {
        await ensureStratoChainInWallet(walletClient as any).catch(() => {});
        return signAndSubmitViaWallet(walletClient, address, type, payload, { username });
      }
      throw new Error("Connect a wallet to sign this transaction");
    },
    [isAppAuthenticated, walletClient, address]
  );

  // STRATO wallets deploy directly (vault signing). External wallets can also deploy,
  // but only by routing through their User wallet contract (username + Use Wallet).
  const canSubmit = isAppAuthenticated || (!!walletClient && !!address);
  return { submit, canSubmit, isAppAuthenticated };
}
