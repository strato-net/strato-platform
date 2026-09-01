import { Interface, JsonRpcProvider, ZeroAddress, getAddress } from "ethers";

export interface DepositSettlementAttestation {
  externalChainId: string;
  depositRouter: string;
  depositId: string;
  externalSender: string;
  externalToken: string;
  externalTokenAmount: string;
  externalTxHash: string;
  externalBlockHash: string;
  externalLogIndex: number;
  stratoRecipient: string;
  stratoToken: string;
  action: string;
  actionToken: string;
  minFinalOut: string;
}

export interface WithdrawalReleaseAttestation {
  withdrawalId: string;
  reservationId: string;
  externalTxHash: string;
  token: string;
  recipient: string;
  amount: string;
}

const depositInterface = new Interface([
  "event DepositRouted(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId,uint8 action,address actionToken,uint256 minFinalOut)",
]);
const transferInterface = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const vaultInterface = new Interface([
  "event WithdrawalReleased(bytes32 indexed reservationId,address indexed token,address indexed recipient,uint256 amount)",
]);

const normalize = (value: string): string =>
  value.replace(/^0x/, "").toLowerCase();

const logIndex = (log: any): number =>
  Number(log.index ?? log.logIndex);

export const validateDepositSettlement = async (
  provider: JsonRpcProvider,
  request: DepositSettlementAttestation,
  custodyAddress: string,
  enabledRouters: string[],
  confirmations: number,
): Promise<void> => {
  const receipt = await provider.getTransactionReceipt(request.externalTxHash);
  if (!receipt || receipt.status !== 1) {
    throw new Error("Deposit receipt is missing or failed");
  }
  if (normalize(receipt.blockHash) !== normalize(request.externalBlockHash)) {
    throw new Error("Deposit block hash changed");
  }
  const latestBlock = await provider.getBlockNumber();
  if (latestBlock - receipt.blockNumber < confirmations) {
    throw new Error("Deposit has insufficient confirmations");
  }

  const routers = new Set(enabledRouters.map(normalize));
  const deposits = receipt.logs
    .filter((log) => routers.has(normalize(log.address)))
    .map((log) => {
      try {
        const parsed = depositInterface.parseLog(log);
        if (!parsed) return null;
        return {
          logIndex: logIndex(log),
          router: normalize(log.address),
          token: normalize(parsed.args.token),
          amount: BigInt(parsed.args.amount),
          sender: normalize(parsed.args.sender),
          recipient: normalize(parsed.args.stratoAddress),
          targetToken: normalize(parsed.args.targetStratoToken),
          depositId: BigInt(parsed.args.depositId),
          action:
            parsed.name === "DepositRoutedWithAction"
              ? BigInt(parsed.args.action)
              : 0n,
          actionToken:
            parsed.name === "DepositRoutedWithAction"
              ? normalize(parsed.args.actionToken)
              : normalize(ZeroAddress),
          minFinalOut:
            parsed.name === "DepositRoutedWithAction"
              ? BigInt(parsed.args.minFinalOut)
              : 0n,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left: any, right: any) => left.logIndex - right.logIndex) as any[];

  const expected = deposits.find(
    (deposit) =>
      deposit.logIndex === request.externalLogIndex &&
      deposit.router === normalize(request.depositRouter),
  );
  if (
    !expected ||
    expected.token !== normalize(request.externalToken) ||
    expected.amount !== BigInt(request.externalTokenAmount) ||
    expected.sender !== normalize(request.externalSender) ||
    expected.recipient !== normalize(request.stratoRecipient) ||
    expected.targetToken !== normalize(request.stratoToken) ||
    expected.depositId !== BigInt(request.depositId) ||
    expected.action !== BigInt(request.action) ||
    expected.actionToken !== normalize(request.actionToken) ||
    expected.minFinalOut !== BigInt(request.minFinalOut)
  ) {
    throw new Error("Deposit event does not match settlement");
  }

  if (expected.token !== normalize(ZeroAddress)) {
    const previousDeposit = deposits
      .filter((deposit) => deposit.logIndex < expected.logIndex)
      .at(-1);
    const matchingTransfers = receipt.logs.filter((log) => {
      if (
        logIndex(log) <= (previousDeposit?.logIndex ?? -1) ||
        logIndex(log) >= expected.logIndex ||
        normalize(log.address) !== expected.token
      ) {
        return false;
      }
      try {
        const parsed = transferInterface.parseLog(log);
        return (
          !!parsed &&
          normalize(parsed.args.from) === expected.sender &&
          normalize(parsed.args.to) === normalize(custodyAddress) &&
          BigInt(parsed.args.value) === expected.amount
        );
      } catch {
        return false;
      }
    });
    if (matchingTransfers.length !== 1) {
      throw new Error("Deposit custody transfer is not unique");
    }
    return;
  }

  const transaction = await provider.getTransaction(request.externalTxHash);
  if (
    !transaction ||
    normalize(transaction.to || "") !== normalize(request.depositRouter) ||
    normalize(transaction.from) !== normalize(request.externalSender) ||
    transaction.value !== BigInt(request.externalTokenAmount)
  ) {
    throw new Error("ETH deposit transaction does not match settlement");
  }
  const traces = await provider.send("trace_transaction", [
    request.externalTxHash,
  ]);
  const custodyMovements = (Array.isArray(traces) ? traces : []).filter(
    (trace: any) =>
      trace.type === "call" &&
      normalize(trace.action?.from || "") ===
        normalize(request.depositRouter) &&
      normalize(trace.action?.to || "") === normalize(custodyAddress) &&
      BigInt(trace.action?.value || 0) ===
        BigInt(request.externalTokenAmount),
  );
  if (custodyMovements.length !== 1) {
    throw new Error("ETH custody transfer is not unique");
  }
};

export const validateWithdrawalRelease = async (
  provider: JsonRpcProvider,
  request: WithdrawalReleaseAttestation,
  vaultAddress: string,
  confirmations: number,
): Promise<void> => {
  const receipt = await provider.getTransactionReceipt(request.externalTxHash);
  if (
    !receipt ||
    receipt.status !== 1 ||
    normalize(receipt.to || "") !== normalize(vaultAddress)
  ) {
    throw new Error("Withdrawal release receipt is missing or failed");
  }
  const latestBlock = await provider.getBlockNumber();
  if (latestBlock - receipt.blockNumber < confirmations) {
    throw new Error("Withdrawal release has insufficient confirmations");
  }
  const matchingEvents = receipt.logs.filter((log) => {
    if (normalize(log.address) !== normalize(vaultAddress)) return false;
    try {
      const parsed = vaultInterface.parseLog(log);
      return (
        !!parsed &&
        normalize(parsed.args.reservationId) ===
          normalize(request.reservationId) &&
        getAddress(parsed.args.token) === getAddress(request.token) &&
        getAddress(parsed.args.recipient) === getAddress(request.recipient) &&
        BigInt(parsed.args.amount) === BigInt(request.amount)
      );
    } catch {
      return false;
    }
  });
  if (matchingEvents.length !== 1) {
    throw new Error("Withdrawal release event does not match settlement");
  }
};
