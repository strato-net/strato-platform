import { getPools } from "../services/pools.service";
import { getBalance } from "../services/tokens.service";

export const getInputPrice = (
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): bigint => {
  if (inputAmount <= 0n || inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid amounts or reserves");
  }

  const inputAmountWithFee = inputAmount * 1000n;
  const numerator = inputAmountWithFee * outputReserve;
  const denominator = inputReserve * 1000n + inputAmountWithFee;

  return numerator / denominator;
};

export const getOutputPrice = (
  outputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): bigint => {
  if (outputAmount <= 0n || inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid amounts or reserves");
  }

  if (outputAmount >= outputReserve) {
    throw new Error("Insufficient liquidity");
  }

  const numerator = inputReserve * outputAmount * 1000n;
  const denominator = (outputReserve - outputAmount) * 1000n;

  return numerator / denominator + 1n;
};

export async function getPoolBalances(
  accessToken: string,
  poolAddress: string
) {
  // Get pool data
  const pool = await getPools(accessToken, {
    address: "eq." + poolAddress,
  });
  if (!pool || pool.length === 0) throw new Error("Pool not found");

  // Get token addresses
  const tokenAddress = pool[0].data.token;
  const stableAddress = pool[0].data.stablecoin;

  // Fetch balances in a single query
  const balancesResponse = await getBalance(accessToken, {
    key: "eq." + poolAddress,
  });

  if (!balancesResponse || !Array.isArray(balancesResponse)) {
    throw new Error("Failed to fetch balances");
  }

  // Extract balances
  const tokenBalance = BigInt(
    balancesResponse.find((b) => b.address === tokenAddress)?.value || "0"
  );
  const stableBalance = BigInt(
    balancesResponse.find((b) => b.address === stableAddress)?.value || "0"
  );

  if (tokenBalance <= 0n || stableBalance <= 0n)
    throw new Error("No liquidity");

  return { tokenBalance, stableBalance, tokenAddress, stableAddress };
}
