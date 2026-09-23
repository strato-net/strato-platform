import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useAccount,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  BridgeToken,
  CompositeRouteQuoteResponse,
} from "@strato/shared-types";
import { assertAutoRouteQuote } from "@/lib/bridge/utils";
import { AutoRouteDepositResult, NetworkSummary } from "@/lib/bridge/types";
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
  const submitting = useRef(false);
  const { toast } = useToast();
  const account = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const {
    externalEvmWalletAddress,
    isExternalEvmWalletConnected,
    isAppAuthenticated,
    stratoAddress,
  } = useUser();

  const execute = async ({
    route,
    network,
    amount,
    quote,
    outputSymbol,
    outputAddress,
    slippageBps,
  }: {
    route: BridgeToken;
    network: NetworkSummary;
    amount: string;
    quote: CompositeRouteQuoteResponse;
    outputSymbol: string;
    outputAddress: string;
    slippageBps: number;
  }): Promise<AutoRouteDepositResult> => {
    if (submitting.current) throw new Error("A deposit is already being submitted");
    submitting.current = true;
    setIsPending(true);
    try {
      quote = structuredClone(quote);
      let approvalConfirmed = false;
      const amountWei = safeParseUnits(amount, Number(route.externalDecimals ?? 18));
      const assertCurrentQuote = () => {
        if (approvalConfirmed && quote.deadline <= Math.floor(Date.now() / 1000)) {
          throw new Error("Quote expired after approval. Your approval succeeded and is reusable; request a new quote. No deposit was sent.");
        }
        assertAutoRouteQuote(quote, {
          externalChainId: network.chainId, externalToken: route.externalToken,
          targetStratoToken: route.stratoToken, externalAmount: amountWei,
          externalDecimals: Number(route.externalDecimals ?? 18), tokenOut: outputAddress, slippageBps,
        });
      };
      assertCurrentQuote();
      if (
        !isExternalEvmWalletConnected ||
        !externalEvmWalletAddress ||
        !account.address
      ) {
        throw new Error("Connect an external wallet to bridge and trade");
      }
      if (
        account.address.toLowerCase() !== externalEvmWalletAddress.toLowerCase()
      ) {
        throw new Error("Connected external wallet address does not match");
      }
      const recipient = isAppAuthenticated ? stratoAddress : externalEvmWalletAddress;
      if (!recipient) {
        throw new Error("STRATO recipient is unavailable");
      }
      if (!network.depositRouter) {
        throw new Error("Deposit router is unavailable");
      }
      const expectedChainId = Number(network.chainId);
      if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
        throw new Error("External network chain ID is not wallet-compatible");
      }
      if (account.chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }

      const isNative = BigInt(route.externalToken || "0") === 0n;
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
        assertCurrentQuote();
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
          assertCurrentQuote();
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
          let approved: boolean;
          try {
            approved = await waitForTransaction(approvalHash, network.chainId);
          } catch {
            return { txHash: approvalHash, status: "pending", type: "approval" };
          }
          if (!approved) {
            throw new Error("Permit2 approval failed");
          }
          approvalConfirmed = true;
        }

        const nonce = getPermit2Nonce();
        assertCurrentQuote();
        const deadline = BigInt(Math.min(quote.deadline, Math.floor(Date.now() / 1000) + 900));
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
        assertCurrentQuote();
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
      try {
        const pending = JSON.parse(
          localStorage.getItem("pendingDeposits") || "[]"
        );
        pending.push({
          externalChainId: Number(network.chainId),
          externalTxHash: txHash,
          depositRouter: network.depositRouter,
          type: actionIntent ? "route" : "bridge",
          finalToken: outputAddress,
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
      } catch {
        toast({
          title: "Deposit submitted; local history unavailable",
          description: `Your transaction was broadcast: ${txHash}. Do not submit it again.`,
        });
      }

      let confirmed: boolean;
      try {
        confirmed = await waitForTransaction(txHash, network.chainId);
      } catch {
        // A timeout or RPC error does not establish whether a broadcast transaction failed.
        return { txHash, status: "pending", type: "deposit" };
      }
      if (!confirmed) {
        try {
          const pending = JSON.parse(localStorage.getItem("pendingDeposits") || "[]");
          localStorage.setItem("pendingDeposits", JSON.stringify(pending.filter(
            (deposit) => deposit.externalTxHash !== txHash ||
              deposit.externalChainId !== Number(network.chainId)
          )));
        } catch {
          // Storage may be unavailable; preserve the confirmed revert error.
        }
        throw new Error("External bridge transaction reverted");
      }
      return { txHash, status: "confirmed", type: "deposit" };
    } finally {
      submitting.current = false;
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
