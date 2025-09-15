// txBuilder.ts
import { DeployInput, FunctionInput, BuiltTx } from "../types/types";
import { constants } from "../config/constants";
import { cirrus } from "./mercataApiHelper";

const DEFAULT_GAS_PARAMS = {
  gasLimit: 32_100_000_000,
  gasPrice: 1,
};

function formatFeeError(feeWei: bigint, requiredUSDST?: bigint) {
  const usd = Number(feeWei) / Number(constants.DECIMALS);
  const requiredUsd = requiredUSDST ? Number(requiredUSDST) / Number(constants.DECIMALS) : 0;
  
  if (requiredUSDST) {
    return `Insufficient balance for gas fees (required: ${usd} USDST for gas. Total needed: ${requiredUsd + usd} USDST - ${requiredUsd} for transaction + ${usd} for gas)`;
  }
  return `Insufficient balance for gas fees (required: ${usd} USDST for gas)`;
}

async function ensureFeeCoverage(
  n: number,
  userAddress: string,
  accessToken: string,
  requiredUSDST?: bigint
) {
  const gasFeeWei = constants.GAS_FEE_WEI * BigInt(n);
  
  // Calculate total required USDST
  const totalRequiredUSDST = requiredUSDST ? requiredUSDST + gasFeeWei : gasFeeWei;

  // Fetch actual balances
  const [voucherResponse, usdstResponse] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Voucher}-_balances`, {
      params: {
        address: `eq.${constants.voucher}`,
        key: `eq.${userAddress}`,
        select: 'value::text'
      },
    }),
    cirrus.get(accessToken, `/${constants.Token}-_balances`, {
      params: {
        address: `eq.${constants.USDST}`,
        key: `eq.${userAddress}`,
        select: 'value::text'
      },
    })
  ]);

  // Get actual balance values
  const voucherBalanceWei = BigInt(voucherResponse.data?.[0]?.value || "0");
  const usdstBalanceWei = BigInt(usdstResponse.data?.[0]?.value || "0");
  
  // Convert vouchers to USDST equivalent
  // 1 voucher (1e18 wei) = 0.01 USDST (1e16 wei)
  // So: voucherUSDST = (voucherBalanceWei * 1e16) / 1e18 = voucherBalanceWei / 100
  const voucherUSDSTEquivalent = voucherBalanceWei / 100n; // 1 voucher = 0.01 USDST  
  const totalAvailableUSDST = usdstBalanceWei + voucherUSDSTEquivalent;

  // Check if total available covers the required amount
  if (totalAvailableUSDST >= totalRequiredUSDST) {
    return;
  }

  // If user doesn't have enough, throw error
  throw new Error(formatFeeError(gasFeeWei, requiredUSDST));
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
  accessToken?: string,
  requiredUSDST?: bigint
): Promise<BuiltTx> {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  if (inputArray.length === 0) throw new Error("At least one transaction input is required");

  if (userAddress && accessToken) {
    await ensureFeeCoverage(inputArray.length, userAddress, accessToken, requiredUSDST);
  }

  const txs = inputArray.map(i => ({
    type: "FUNCTION" as const,
    payload: { contractName: i.contractName, contractAddress: i.contractAddress, method: i.method, args: i.args },
  }));

  return { txs, txParams: DEFAULT_GAS_PARAMS };
}