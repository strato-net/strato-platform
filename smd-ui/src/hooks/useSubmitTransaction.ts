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
    async (type: StratoTxType, payload: Record<string, unknown>) => {
      if (isAppAuthenticated) {
        return submitStratoTx(type, payload);
      }
      // External-wallet (EIP-712) signing only supports MessageTX-style txs on the
      // node — function calls and transfers. Contract creation must go through the
      // STRATO wallet (server-side vault signing).
      if (type === "CONTRACT") {
        throw new Error(
          "Deploying a contract requires the STRATO wallet. Connect with the STRATO wallet to deploy; external wallets can call functions and send tokens."
        );
      }
      if (walletClient && address) {
        await ensureStratoChainInWallet(walletClient as any).catch(() => {});
        return signAndSubmitViaWallet(walletClient, address, type, payload);
      }
      throw new Error("Connect a wallet to sign this transaction");
    },
    [isAppAuthenticated, walletClient, address]
  );

  const canSubmit = isAppAuthenticated || (!!walletClient && !!address);
  // Contract deploys are only possible with the STRATO wallet (vault signing).
  const canDeploy = isAppAuthenticated;
  return { submit, canSubmit, canDeploy };
}
