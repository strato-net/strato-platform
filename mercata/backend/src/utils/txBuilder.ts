// txBuilder.ts
import { DeployInput, FunctionInput, BuiltTx } from "../types/types";
import { constants } from "../config/constants";
import { cirrus } from "./mercataApiHelper";

const DEFAULT_GAS_PARAMS = {
  gasLimit: 32_100_000_000,
  gasPrice: 1,
};

const VOUCHER_TO_USDST_FACTOR = 100n; // 1 voucher = 0.01 USDST

function formatUsd(weiAmount: bigint, precision = 4): string {
  if (weiAmount === 0n) {
    return "0";
  }

  const whole = weiAmount / constants.DECIMALS;
  const fraction = weiAmount % constants.DECIMALS;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction
    .toString()
    .padStart(18, "0")
    .slice(0, precision)
    .replace(/0+$/, "");

  return fractionStr ? `${whole.toString()}.${fractionStr}` : whole.toString();
}

async function fetchBalance(
  accessToken: string,
  table: string,
  contractAddress: string,
  userAddress: string
): Promise<bigint> {
  const { data } = await cirrus.get(accessToken, `/${table}`, {
    params: {
      address: `eq.${contractAddress}`,
      key: `eq.${userAddress}`,
      select: "value::text",
    },
  });

  const rawValue = data?.[0]?.value ?? "0";
  try {
    return BigInt(rawValue);
  } catch {
    return 0n;
  }
}

async function ensureFeeCoverage(
  txCount: number,
  userAddress: string,
  accessToken: string
): Promise<void> {
  if (txCount <= 0) return;

  const feePerTxWei = constants.GAS_FEE_WEI;
  const requiredWei = feePerTxWei * BigInt(txCount);

  const [voucherWei, usdstWei] = await Promise.all([
    fetchBalance(accessToken, `${constants.Voucher}-_balances`, constants.voucher, userAddress),
    fetchBalance(accessToken, `${constants.Token}-_balances`, constants.USDST, userAddress),
  ]);

  const voucherAsUsdWei = voucherWei / VOUCHER_TO_USDST_FACTOR;
  const totalAvailableWei = usdstWei + voucherAsUsdWei;

  if (totalAvailableWei >= requiredWei) return;

  // Calculate how much USDST portion would be needed (vouchers used first)
  const usdPortionNeeded = requiredWei > voucherAsUsdWei ? requiredWei - voucherAsUsdWei : 0n;
  
  // If you want partial, compute the max affordable txs and throw a clear error
  const maxTx = Number(totalAvailableWei / feePerTxWei); // floor
  throw new Error(
    `Insufficient USDST + voucher balance for transaction fee. Required: ${formatUsd(requiredWei)} USDST, ` +
    `Available: ${formatUsd(totalAvailableWei)} USDST (${formatUsd(usdstWei)} USDST + ${formatUsd(voucherAsUsdWei)} vouchers), ` +
    `USDST portion needed: ${formatUsd(usdPortionNeeded)}, Max affordable txs: ${maxTx}`
  );
}

export function buildDeployTx({
  contractName,
  source,
  args,
}: DeployInput): BuiltTx {
  const tx = {
    type: "CONTRACT" as const,
    payload: { contract: contractName, src: source, args },
  };

  return {
    txs: [tx],
    txParams: DEFAULT_GAS_PARAMS,
  };
}

export async function buildFunctionTx(
  inputs: FunctionInput | FunctionInput[],
  userAddress?: string,
  accessToken?: string
): Promise<BuiltTx> {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];

  if (!inputArray.length) {
    throw new Error("At least one transaction input is required");
  }

  if (userAddress && accessToken) {
    await ensureFeeCoverage(inputArray.length, userAddress, accessToken);
  }

  const txs = inputArray.map((input) => ({
    type: "FUNCTION" as const,
    payload: {
      contractName: input.contractName,
      contractAddress: input.contractAddress,
      method: input.method,
      args: input.args,
    },
  }));

  return {
    txs,
    txParams: DEFAULT_GAS_PARAMS,
  };
}
