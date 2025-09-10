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
  const requiredFeeWei = constants.GAS_FEE_WEI * BigInt(n);
  const requiredVoucherUnits = constants.DECIMALS * BigInt(n);

  // Calculate total required USDST
  const totalRequiredUSDST = requiredUSDST ? requiredUSDST + requiredFeeWei : requiredFeeWei;

  // Check both voucher and USDST balances in parallel
  const [voucherResponse, usdstResponse] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Voucher}-_balances`, {
      params: {
        address: `eq.${constants.voucher}`,
        key: `eq.${userAddress}`,
        value: `gte.${requiredVoucherUnits.toString()}`,
      },
    }),
    cirrus.get(accessToken, `/${constants.Token}-_balances`, {
      params: {
        address: `eq.${constants.USDST}`,
        key: `eq.${userAddress}`,
        value: `gte.${totalRequiredUSDST.toString()}`,
      },
    })
  ]);

  // If user has enough vouchers OR enough USDST, they're good to go
  const hasVoucher = voucherResponse.data && voucherResponse.data.length > 0;
  const hasUSD = usdstResponse.data && usdstResponse.data.length > 0;

  if (hasVoucher || hasUSD) {
    return;
  }

  // If user doesn't have enough of either, throw error
  throw new Error(formatFeeError(requiredFeeWei, requiredUSDST));
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