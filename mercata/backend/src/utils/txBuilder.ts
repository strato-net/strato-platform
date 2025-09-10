// txBuilder.ts
import { DeployInput, FunctionInput, BuiltTx } from "../types/types";
import { constants } from "../config/constants";
import { cirrus } from "./mercataApiHelper";

const DEFAULT_GAS_PARAMS = {
  gasLimit: 32_100_000_000,
  gasPrice: 1,
};

type Balances = Record<string, bigint>;

function formatFeeError(feeWei: bigint, voucherUnits: bigint, requiredUSDST?: bigint) {
  const usd = Number(feeWei) / Number(constants.DECIMALS);
  const vouchers = Number(voucherUnits) / Number(constants.DECIMALS);
  const requiredUsd = requiredUSDST ? Number(requiredUSDST) / Number(constants.DECIMALS) : 0;
  
  if (requiredUSDST) {
    return `Insufficient balance (required: ${vouchers} vouchers OR ${requiredUsd + usd} USDST total: ${requiredUsd} for transaction + ${usd} for gas)`;
  }
  return `Insufficient balance for transaction fees (required: ${vouchers} vouchers OR ${usd} USDST)`;
}

async function ensureFeeCoverage(
  n: number,
  userAddress: string,
  accessToken: string,
  requiredUSDST?: bigint
) {
  const requiredFeeWei = constants.GAS_FEE_WEI * BigInt(n);
  const requiredVoucherUnits = constants.DECIMALS * BigInt(n);

  const { data } = await cirrus.get(
    accessToken,
    `/${constants.Token}-_balances`,
    {
      params: {
        address: `in.(${constants.voucher},${constants.USDST})`,
        key: `eq.${userAddress}`,
        select: "address,balance:value::text",
      },
    }
  );

  if (!Array.isArray(data)) throw new Error(formatFeeError(requiredFeeWei, requiredVoucherUnits, requiredUSDST));

  const balances: Balances = data.reduce((m: Balances, r: any) => {
    m[r.address] = BigInt(r.balance ?? "0");
    return m;
  }, {});

  const hasVoucher = (balances[constants.voucher] ?? 0n) >= requiredVoucherUnits;
  
  // If user has vouchers, they're good to go
  if (hasVoucher) return;
  
  // If no vouchers, check if they have enough USDST for both transaction amount + gas
  const totalRequiredUSDST = requiredUSDST ? requiredUSDST + requiredFeeWei : requiredFeeWei;
  const hasUSD = (balances[constants.USDST] ?? 0n) >= totalRequiredUSDST;
  
  if (!hasUSD) throw new Error(formatFeeError(requiredFeeWei, requiredVoucherUnits, requiredUSDST));
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