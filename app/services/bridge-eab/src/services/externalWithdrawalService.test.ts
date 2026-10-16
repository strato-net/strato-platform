import assert from "node:assert/strict";
import test from "node:test";

for (const name of [
  "ALCHEMY_API_KEY", "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID",
  "OPENID_DISCOVERY_URL", "EXTERNAL_ASSET_BRIDGE_ADDRESS", "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS", "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION",
  "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_ID", "RELAYER_CLIENT_SECRET",
  "RELAYER_OPENID_DISCOVERY_URL", "STRATO_NODE_URL", "VAULT_PROXY_ADDRESS", "VOUCHER_CONTRACT_ADDRESS",
]) process.env[name] ||= "1111111111111111111111111111111111111111";
process.env.SENDGRID_API_KEY = "SG.test.test";
process.env.CHAIN_11155111_RPC_URL = "https://rpc.invalid";

const vaultAddress = `0x${"2".repeat(40)}`;
const tokenAddress = `0x${"3".repeat(40)}`;

// The liquidity check is a pre-READY snapshot, not atomic with the vault's reserve():
// a concurrent reservation can still consume liquidity first, backstopped by
// retry-until-deadline and the refund path.
test("withdrawal capacity is capped by vault liquidity so liquidity-bound withdrawals are not marked READY", async () => {
  const { Interface, JsonRpcProvider, MaxUint256, getAddress } = await import("ethers");
  const { getWithdrawalCapacity } = await import("./externalWithdrawalService");
  const { closeChainProviders } = await import("./rpcService");
  const iface = new Interface([
    "function withdrawalCapacity(address token,uint256 amount) view returns (uint256 available,uint256 retryAfterSeconds)",
    "function availableLiquidity(address token) view returns (uint256)",
  ]);
  // [bucket, bucketRetry, liquidity, expectedAvailable, expectedRetry]; amount is 3_500_000.
  const cases: Array<[bigint, bigint, bigint, bigint, bigint]> = [
    // Rate-limit bucket has room but the vault lacks liquidity (#55 shape): no retry schedule.
    [5_000_000n, 0n, 2_770_000n, 2_770_000n, MaxUint256],
    // Bucket is the binding constraint: the vault's refill estimate passes through.
    [1_000_000n, 600n, 10_000_000n, 1_000_000n, 600n],
    // Both sufficient: capacity reports the tighter bound and keeps the bucket schedule.
    [5_000_000n, 0n, 4_000_000n, 4_000_000n, 0n],
  ];
  const original = JsonRpcProvider.prototype.call;
  try {
    for (const [bucket, bucketRetry, liquidity, expectedAvailable, expectedRetry] of cases) {
      (JsonRpcProvider.prototype as any).call = async (tx: any) => {
        assert.equal(String(tx.to).toLowerCase(), vaultAddress.toLowerCase());
        const call = iface.parseTransaction(tx)!;
        assert.equal(call.args[0], getAddress(tokenAddress));
        if (call.name === "withdrawalCapacity") {
          assert.equal(call.args[1], 3_500_000n);
          return iface.encodeFunctionResult("withdrawalCapacity", [bucket, bucketRetry]);
        }
        assert.equal(call.name, "availableLiquidity");
        return iface.encodeFunctionResult("availableLiquidity", [liquidity]);
      };
      const capacity = await getWithdrawalCapacity({
        withdrawalId: "55", vault: vaultAddress, externalChainId: "11155111",
        externalToken: tokenAddress, externalTokenAmount: "3500000",
      } as any);
      assert.equal(capacity.available, expectedAvailable);
      assert.equal(capacity.retryAfterSeconds, expectedRetry);
    }
  } finally {
    (JsonRpcProvider.prototype as any).call = original;
    closeChainProviders();
  }
});
