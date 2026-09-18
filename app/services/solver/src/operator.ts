/**
 * Bridge-operator actions for a STRATO native withdrawal, plus the USDST
 * transfer that pays for them.
 *
 * `markWithdrawalPending` and `finalizeWithdrawal` are onlyBridgeOperator, and
 * that modifier is a plain address comparison with no governance fallthrough --
 * so they can only be driven by whichever key the bridge currently names. The
 * helium relayer has been dormant on this route since 2026-07-20, so without
 * something like this a withdrawal requested today never leaves INITIATED and
 * its locked tokens are never accounted for.
 *
 *   OPERATOR_PRIVATE_KEY=<hex> npx ts-node src/operator.ts mark <id>
 *   OPERATOR_PRIVATE_KEY=<hex> npx ts-node src/operator.ts finalize <id> <externalTxHash>
 *   npx ts-node src/operator.ts fund <address> <amount> [symbol] # paid by the solver key
 */
import { config, assertConfigured } from "./config";
import { StratoSolverClient } from "./strato";
import { tokenBalance } from "./discovery";

const NATIVE_BRIDGE = config.nativeBridge;
const USDST = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";

/**
 * Tokens the operator/funding helper knows by name, all 18 decimals on helium.
 * USDCST is the DEFAULT route target for Sepolia USDC -- not USDST, which is a
 * separate asset whose own USDC route is disabled. Getting this wrong fails
 * late, inside _recordDeposit, as "MB: route not enabled".
 */
const FUNDABLE: Record<string, string> = {
  USDST,
  USDCST: "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
};

const operatorClient = () => {
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (!key) throw new Error("set OPERATOR_PRIVATE_KEY");
  return new StratoSolverClient(key, config.strato);
};

const report = (label: string, results: { status: string; hash: string; message?: string }[]) => {
  for (const r of results) {
    console.log(`  ${label}: ${r.status} ${r.hash}${r.message ? ` -- ${r.message}` : ""}`);
  }
  if (results.some((r) => r.status !== "Success")) throw new Error(`${label} failed`);
};

async function main() {
  const [cmd, a, b] = process.argv.slice(2);

  if (cmd === "fund") {
    assertConfigured();
    const solver = new StratoSolverClient(config.privateKey, config.strato);
    const symbol = (process.argv[5] ?? "USDST").toUpperCase();
    const token = FUNDABLE[symbol];
    if (!token) throw new Error(`unknown token ${symbol}; try ${Object.keys(FUNDABLE).join(", ")}`);
    const to = a.replace(/^0x/, "").toLowerCase();
    const amount = BigInt(Math.round(Number(b) * 1e6)) * 10n ** 12n; // 18dp, 6dp of input
    // USDST is the gas token on STRATO, so an operator key with a zero balance
    // cannot send anything at all -- including the call that would fund it.
    console.log(`solver ${solver.address} -> ${to}: ${amount} ${symbol} (18dp)`);
    report("transfer", await solver.call([{
      contractName: "ERC20",
      contractAddress: token,
      method: "transfer",
      args: { to, value: amount.toString() },
    }]));
    console.log(`recipient now holds ${await tokenBalance(solver, token, to)}`);
    return;
  }

  const client = operatorClient();
  const state = await client.readState("StratoNativeBridge", NATIVE_BRIDGE);
  if (state?.bridgeOperator !== client.stratoAddress) {
    throw new Error(
      `this key is not the bridge operator: bridge names ${state?.bridgeOperator}, ` +
      `key is ${client.stratoAddress}`,
    );
  }
  const gas = await tokenBalance(client, USDST, client.stratoAddress);
  console.log(`operator ${client.address}  USDST for gas: ${gas}`);
  if (gas === 0n) throw new Error("operator holds no USDST; run `fund` first");

  if (cmd === "mark") {
    console.log(`markWithdrawalPending(${a})`);
    report("mark", await client.call([{
      contractName: "StratoNativeBridge",
      contractAddress: NATIVE_BRIDGE,
      method: "markWithdrawalPending",
      args: { id: a },
    }]));
    const after = await client.cirrus("BlockApps-StratoNativeBridge-withdrawals", {
      address: `eq.${NATIVE_BRIDGE}`, key: `eq.${a}`,
    });
    const rec = after[0]?.value;
    console.log(`  bridgeStatus now ${rec?.bridgeStatus} (2 = PENDING_REVIEW)`);
    console.log(`  nativeMintNotBefore ${rec?.nativeMintNotBefore}`);
    return;
  }

  if (cmd === "finalize") {
    if (!b) throw new Error("finalize needs the external tx hash");
    console.log(`finalizeWithdrawal(${a}, ${b})`);
    report("finalize", await client.call([{
      contractName: "StratoNativeBridge",
      contractAddress: NATIVE_BRIDGE,
      method: "finalizeWithdrawal",
      args: { id: a, externalTxHash: b, nativeMintProposalHash: "" },
    }]));
    const after = await client.cirrus("BlockApps-StratoNativeBridge-withdrawals", {
      address: `eq.${NATIVE_BRIDGE}`, key: `eq.${a}`,
    });
    console.log(`  bridgeStatus now ${after[0]?.value?.bridgeStatus} (3 = COMPLETED)`);
    return;
  }

  throw new Error(`unknown command "${cmd}"; use mark, finalize, or fund`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
