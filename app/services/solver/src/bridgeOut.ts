/**
 * Move solver inventory from STRATO out to an external chain.
 *
 * WHY A SOLVER NEEDS THIS. Filling an inbound deposit pays the recipient in a
 * STRATO asset, so it drains STRATO-side inventory. Filling an outbound
 * withdrawal pays the recipient in the EXTERNAL representation, so it needs
 * inventory on the external chain -- which a solver that has only ever filled
 * deposits does not have. Bridging its own balance out is how it rebalances,
 * and on the native route the external side MINTS, so it does not depend on
 * anyone's external liquidity.
 *
 *   npx ts-node src/bridgeOut.ts <tokenSymbol> <amount> [recipient]
 *
 * Emits a JSON file for app/ethereum/scripts/nativeMintDeliver.js, which
 * performs the external delivery leg.
 */
import fs from "fs";
import { config, assertConfigured } from "./config";
import { StratoSolverClient } from "./strato";
import { tokenBalance } from "./discovery";

const NATIVE_BRIDGE = "49f69252b00235030a4dcd4c7ef17a64ef346258";
const EXTERNAL_CHAIN_ID = "11155111";

/**
 * Withdrawals are pulled by the custody VAULT, not by the bridge, so the
 * approval has to name the vault. Approving the bridge instead fails inside
 * `lock` with nothing that points at the allowance.
 */
const CUSTODY_VAULT = "8cfe7b576f69260673e9a1a9517137f12a49ed93";

const TOKENS: Record<string, { strato: string; representation: string; decimals: number }> = {
  USDST: {
    strato: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
    representation: "cc022fe41bafe03a0030d275cdf0b72c260f15c9",
    decimals: 18,
  },
  GOLDST: {
    strato: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
    representation: "e0f3049ff002b1445afc3c9a0d23cc882bacea8a",
    decimals: 18,
  },
  SILVST: {
    strato: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
    representation: "fcd327f4eccacd9a8b41ac608b13d8bf265ce1c9",
    decimals: 18,
  },
  saveUSDST: {
    strato: "ceeb982f671b4ee2b4471e5b49f3126739537f15",
    representation: "f2a69e500656ebaa63e1d38d5eb841ea66fd794e",
    decimals: 18,
  },
  // STRATO is deliberately absent: tokenBridgeConfigs has
  // withdrawalsDisabled = true for it on helium, so a request always reverts.
};

const scale = (amount: string, decimals: number): bigint => {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals));
};

async function main() {
  const [symbol, amountArg, recipientArg] = process.argv.slice(2);
  const token = TOKENS[symbol];
  if (!token) {
    throw new Error(
      `unknown or non-withdrawable token "${symbol}"; try ${Object.keys(TOKENS).join(", ")}`,
    );
  }
  const amount = scale(amountArg, token.decimals);
  if (amount <= 0n) throw new Error("amount must be positive");

  assertConfigured();
  const client = new StratoSolverClient(config.privateKey, config.strato);
  const recipient = (recipientArg ?? client.stratoAddress).replace(/^0x/, "").toLowerCase();

  const held = await tokenBalance(client, token.strato, client.stratoAddress);
  console.log(`solver ${client.address}`);
  console.log(`holds  ${held} of ${symbol} (${token.strato})`);
  console.log(`sending ${amount} to ${recipient} on chain ${EXTERNAL_CHAIN_ID}`);
  if (held < amount) throw new Error(`insufficient ${symbol}: have ${held}, need ${amount}`);

  const before = await client.readState("StratoNativeBridge", NATIVE_BRIDGE);
  const counterBefore = BigInt(before?.withdrawalCounter ?? 0);

  // One bundle: the client renumbers nonces sequentially before signing, which
  // is required because the node hands every tx in a bundle the same nonce.
  const results = await client.call([
    {
      contractName: "ERC20",
      contractAddress: token.strato,
      method: "approve",
      args: { spender: CUSTODY_VAULT, value: amount.toString() },
    },
    {
      contractName: "StratoNativeBridge",
      contractAddress: NATIVE_BRIDGE,
      method: "requestWithdrawal",
      args: {
        externalChainId: EXTERNAL_CHAIN_ID,
        externalRecipient: recipient,
        stratoToken: token.strato,
        stratoTokenAmount: amount.toString(),
      },
    },
  ]);
  results.forEach((r, i) => console.log(`  tx ${i}: ${r.status} ${r.hash}${r.message ? ` -- ${r.message}` : ""}`));
  if (results.some((r) => r.status !== "Success")) throw new Error("a leg failed; nothing to deliver");

  const after = await client.readState("StratoNativeBridge", NATIVE_BRIDGE);
  const id = BigInt(after?.withdrawalCounter ?? 0);
  if (id <= counterBefore) throw new Error("withdrawal counter did not advance");

  // Verify the record really is ours before telling the delivery script to
  // mint against it: the counter is global, so a concurrent withdrawal from
  // someone else would otherwise be delivered to our recipient.
  const record = (await client.cirrus("BlockApps-StratoNativeBridge-withdrawals", {
    address: `eq.${NATIVE_BRIDGE}`,
    "collection_name": "eq.withdrawals",
    key: `eq.${id}`,
  }))[0]?.value;
  if (!record) throw new Error(`withdrawal ${id} not visible in Cirrus yet; re-run the read before delivering`);
  const mismatch = [
    ["stratoSender", record.stratoSender, client.stratoAddress],
    ["stratoToken", record.stratoToken, token.strato],
    ["externalRecipient", record.externalRecipient, recipient],
    ["stratoTokenAmount", String(record.stratoTokenAmount), amount.toString()],
  ].filter(([, got, want]) => String(got).toLowerCase() !== String(want).toLowerCase());
  if (mismatch.length) {
    throw new Error(
      `withdrawal ${id} is not the one we just made: ` +
      mismatch.map(([f, got, want]) => `${f} ${got} != ${want}`).join(", "),
    );
  }

  const out = {
    withdrawalId: id.toString(),
    stratoToken: `0x${token.strato}`,
    representationToken: `0x${record.representationToken}`,
    recipient: `0x${recipient}`,
    amount: String(record.stratoTokenAmount),
    requestedAt: String(record.requestedAt),
    maxFee: "0",
    feeHalfLife: "0",
  };
  const path = `/tmp/native-withdrawal-${id}.json`;
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nwithdrawal ${id} requested, tokens locked in the vault`);
  console.log(`wrote ${path}`);
  console.log(
    `\nDeliver it:\n  ATTESTATION_SIGNER_KEY=<signer> node ../../ethereum/scripts/nativeMintDeliver.js ${path}`,
  );
}

main().catch((e) => { console.error(e.message); process.exit(1); });
