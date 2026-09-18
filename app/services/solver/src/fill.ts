/**
 * Fill a Mercata deposit as a solver -- rung zero or any later rung.
 *
 * Takes the expected recipient/token/amount explicitly rather than reading them
 * from Cirrus: the deposits table is a nested mapping and has repeatedly failed
 * to surface a row that the contract demonstrably holds, so the contract's own
 * `expected*` guards are the reliable check. If any of them disagree with
 * chain state the call reverts by name ("recipient mismatch", "amount
 * mismatch"), which is exactly the confirmation we want.
 *
 *   FILL_KEY=<hex> npx ts-node src/fill.ts <txHash> <expectedFee> <transferable> <exitFee>
 */
import { config } from "./config";
import { StratoSolverClient } from "./strato";
import { tokenBalance } from "./discovery";

const BRIDGE = config.mercataBridge;
const CHAIN_ID = "11155111";
const RECIPIENT = "4444444444444444444444444444444444444444";
const TOKEN = "6aeacaa19c68e53035bf495d15e0a328fc600ba8";
const AMOUNT = (50n * 10n ** 18n).toString();

const fmt = (v: bigint) => {
  const s = v.toString().padStart(19, "0");
  return `${s.slice(0, -18)}.${s.slice(-18)}`.replace(/0+$/, "").replace(/\.$/, ".0");
};

async function main() {
  const [txHash, expectedFeeArg, transferableArg, exitFeeArg] = process.argv.slice(2);
  const key = process.env.FILL_KEY;
  if (!key || !txHash) throw new Error("usage: FILL_KEY=<hex> fill.ts <txHash> <expectedFee> <transferable> <exitFee>");

  const toWei = (s: string) => BigInt(Math.round(Number(s) * 1e6)) * 10n ** 12n;
  const expectedFee = toWei(expectedFeeArg ?? "0");
  const transferable = (transferableArg ?? "false") === "true";
  const exitFee = toWei(exitFeeArg ?? "0");

  const client = new StratoSolverClient(key, config.strato);
  console.log(`filler ${client.address}`);
  const before = {
    filler: await tokenBalance(client, TOKEN, client.stratoAddress),
    recipient: await tokenBalance(client, TOKEN, RECIPIENT),
  };
  console.log(`  filler holds    ${fmt(before.filler)}`);
  console.log(`  recipient holds ${fmt(before.recipient)}`);
  console.log(`  quoting expectedFee=${fmt(expectedFee)} transferable=${transferable} exitFee=${fmt(exitFee)}`);

  // approve + fill in one bundle; the client renumbers nonces before signing.
  const results = await client.call([
    {
      contractName: "ERC20",
      contractAddress: TOKEN,
      method: "approve",
      args: { spender: BRIDGE, value: AMOUNT },
    },
    {
      contractName: "MercataBridge",
      contractAddress: BRIDGE,
      method: "fillDeposit",
      args: {
        externalChainId: CHAIN_ID,
        externalTxHash: txHash,
        expectedStratoRecipient: RECIPIENT,
        expectedStratoToken: TOKEN,
        expectedStratoTokenAmount: AMOUNT,
        expectedFee: expectedFee.toString(),
        transferable,
        exitFee: exitFee.toString(),
      },
    },
  ]);
  results.forEach((r, i) => console.log(`  tx ${i}: ${r.status} ${r.hash}${r.message ? ` -- ${r.message}` : ""}`));

  const after = {
    filler: await tokenBalance(client, TOKEN, client.stratoAddress),
    recipient: await tokenBalance(client, TOKEN, RECIPIENT),
  };
  console.log(`  filler    ${fmt(before.filler)} -> ${fmt(after.filler)}  (${fmt(after.filler - before.filler)})`);
  console.log(`  recipient ${fmt(before.recipient)} -> ${fmt(after.recipient)}  (${fmt(after.recipient - before.recipient)})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
