import { useState } from "react";
import { useAccount, useSignTypedData, useWriteContract } from "wagmi";
import {
  BridgeToken,
  CompositeRouteQuoteResponse,
} from "@strato/shared-types";
import { NetworkSummary } from "@/lib/bridge/types";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import {
  checkPermit2Approval,
  createPermit2Message,
  getPermit2Domain,
  getPermit2Nonce,
  getPermit2Types,
  simulateDeposit,
  validateRouterContract,
  waitForTransaction,
} from "@/lib/bridge/contractService";
import {
  DEPOSIT_ROUTER_ABI,
  ERC20_ABI,
  NATIVE_TOKEN_ADDRESS,
  PERMIT2_ADDRESS,
  resolveViemChain,
} from "@/lib/bridge/constants";
import { ensureHexPrefix, safeParseUnits } from "@/utils/numberUtils";

export function useAutoRouteDeposit() {
  const [isPending, setIsPending] = useState(false);
  const account = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const {
    externalEvmWalletAddress,
    isExternalEvmWalletConnected,
    isAppAuthenticated,
    stratoAddress,
  } = useUser();
  const { triggerDepositRefresh } = useBridgeContext();

  const execute = async ({
    route,
    network,
    amount,
    quote,
    outputSymbol,
  }: {
    route: BridgeToken;
    network: NetworkSummary;
    amount: string;
    quote: CompositeRouteQuoteResponse;
    outputSymbol: string;
  }) => {
    if (
      !isExternalEvmWalletConnected ||
      !externalEvmWalletAddress ||
      !account.address
    ) {
      throw new Error("Connect an external wallet to bridge and trade");
    }
    const recipient = isAppAuthenticated
      ? stratoAddress
      : externalEvmWalletAddress;
    if (!recipient) throw new Error("STRATO recipient is unavailable");
    if (!network.depositRouter) {
      throw new Error("Deposit router is unavailable");
    }

    setIsPending(true);
    try {
      const isNative = BigInt(route.externalToken || "0") === 0n;
      const amountWei = safeParseUnits(
        amount,
        Number(route.externalDecimals || 18)
      );
      const validation = await validateRouterContract({
        depositRouterAddress: network.depositRouter,
        amount,
        decimals: route.externalDecimals,
        chainId: network.chainId,
        tokenAddress: isNative
          ? NATIVE_TOKEN_ADDRESS
          : route.externalToken,
        targetStratoToken: route.stratoToken,
      });
      if (!validation.isValid) {
        throw new Error(
          validation.error || "Bridge deposit validation failed"
        );
      }

      const chain = await resolveViemChain(network.chainId);
      const actionIntent =
        quote.depositAction.action === 0
          ? undefined
          : {
              action: quote.depositAction.action,
              actionToken: quote.depositAction.actionToken,
              minFinalOut: BigInt(quote.depositAction.minFinalOut),
            };
      let txHash: `0x${string}`;
      if (isNative) {
        await simulateDeposit({
          depositRouter: network.depositRouter,
          isNative: true,
          amount: amountWei,
          userAddress: recipient,
          targetStratoToken: route.stratoToken,
          account: externalEvmWalletAddress,
          chainId: network.chainId,
          actionIntent,
        });
        txHash = actionIntent
          ? await writeContractAsync({
              address: ensureHexPrefix(network.depositRouter),
              abi: DEPOSIT_ROUTER_ABI,
              functionName: "depositETHWithAction",
              args: [
                ensureHexPrefix(recipient),
                ensureHexPrefix(route.stratoToken),
                actionIntent.action,
                ensureHexPrefix(actionIntent.actionToken),
                actionIntent.minFinalOut,
              ],
              value: amountWei,
              chain,
              account: account.address,
            })
          : await writeContractAsync({
              address: ensureHexPrefix(network.depositRouter),
              abi: DEPOSIT_ROUTER_ABI,
              functionName: "depositETH",
              args: [
                ensureHexPrefix(recipient),
                ensureHexPrefix(route.stratoToken),
              ],
              value: amountWei,
              chain,
              account: account.address,
            });
      } else {
        const approval = await checkPermit2Approval({
          token: route.externalToken,
          owner: externalEvmWalletAddress,
          amount: amountWei,
          chainId: network.chainId,
        });
        if (!approval.isApproved) {
          const approvalHash = await writeContractAsync({
            address: ensureHexPrefix(route.externalToken),
            abi: ERC20_ABI,
            functionName: "approve",
            args: [
              PERMIT2_ADDRESS,
              2n ** 256n - 1n,
            ],
            chain,
            account: account.address,
          });
          if (!(await waitForTransaction(approvalHash, network.chainId))) {
            throw new Error("Permit2 approval failed");
          }
        }

        const nonce = getPermit2Nonce();
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
        const signature = await signTypedDataAsync({
          domain: getPermit2Domain(network.chainId),
          types: getPermit2Types(),
          primaryType: "PermitTransferFrom",
          message: createPermit2Message({
            token: route.externalToken,
            amount: amountWei,
            spender: network.depositRouter,
            nonce,
            deadline,
          }),
          account: account.address,
        });
        await simulateDeposit({
          depositRouter: network.depositRouter,
          isNative: false,
          tokenAddress: route.externalToken,
          amount: amountWei,
          userAddress: recipient,
          targetStratoToken: route.stratoToken,
          account: externalEvmWalletAddress,
          chainId: network.chainId,
          permitData: { nonce, deadline, signature },
          actionIntent,
        });

        const commonArgs = [
          ensureHexPrefix(route.externalToken),
          amountWei,
          ensureHexPrefix(recipient),
          ensureHexPrefix(route.stratoToken),
        ] as const;
        txHash = actionIntent
          ? await writeContractAsync({
              address: ensureHexPrefix(network.depositRouter),
              abi: DEPOSIT_ROUTER_ABI,
              functionName: "depositWithAction",
              args: [
                ...commonArgs,
                actionIntent.action,
                ensureHexPrefix(actionIntent.actionToken),
                actionIntent.minFinalOut,
                nonce,
                deadline,
                signature,
              ],
              chain,
              account: account.address,
            })
          : await writeContractAsync({
              address: ensureHexPrefix(network.depositRouter),
              abi: DEPOSIT_ROUTER_ABI,
              functionName: "deposit",
              args: [...commonArgs, nonce, deadline, signature],
              chain,
              account: account.address,
            });
      }
      if (!(await waitForTransaction(txHash, network.chainId))) {
        throw new Error("External bridge transaction reverted");
      }

      const pending = JSON.parse(
        localStorage.getItem("pendingDeposits") || "[]"
      );
      pending.push({
        externalChainId: Number(network.chainId),
        externalTxHash: txHash,
        depositRouter: network.depositRouter,
        type: actionIntent ? "route" : "bridge",
        finalTokenSymbol: outputSymbol,
        finalAmount: quote.amountOut,
        DepositInfo: {
          externalSender: externalEvmWalletAddress,
          stratoRecipient: recipient,
          stratoToken: route.stratoToken,
          stratoTokenAmount: quote.bridge.bridgedAmount,
          bridgeStatus: "1",
        },
        block_timestamp: new Date().toISOString(),
        stratoTokenSymbol: route.stratoTokenSymbol,
        externalName: route.externalName,
        externalSymbol: route.externalSymbol,
      });
      localStorage.setItem("pendingDeposits", JSON.stringify(pending));
      triggerDepositRefresh();
      return txHash;
    } finally {
      setIsPending(false);
    }
  };

  return {
    execute,
    isPending,
    connectedAddress: externalEvmWalletAddress,
    connectedChainId: account.chainId,
  };
}
