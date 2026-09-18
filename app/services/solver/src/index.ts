/**
 * The solver: fills STRATO bridge transfers ahead of the slow path.
 *
 * It pays a bridge recipient out of its own inventory, and in exchange takes
 * over the claim on the settlement that recipient would otherwise have waited
 * for. What it keeps is the decayed fee the user offered. Nothing here bypasses
 * a review, a time lock, or a multisig -- the solver waits for all of it and
 * carries the risk that the transfer is aborted or the claim voided, which is
 * exactly what the fee prices.
 *
 * WHAT IT REFUSES TO DO, and why each one is a loss rather than a missed
 * opportunity:
 *   - Fill an ANNOUNCED-only deposit unless explicitly told to. That record is
 *     an unverified claim by a stranger; if the relayer contradicts it the
 *     claim is void and the payment is gone.
 *   - Fill below the policy's minimum fee. The downside of a voided claim is
 *     the whole net fronted, not the fee, so a thin fee is not worth the tail.
 *   - Take over a claim whose holder has not offered it for sale, or whose
 *     asking price it has not agreed to.
 *   - Spend a token below its reserve. USDST is also gas on STRATO, so
 *     draining it strands the solver entirely.
 */
import { config, assertConfigured, loadReserves } from "./config";
import { StratoSolverClient } from "./strato";
import { decayedFee } from "./pricing";
import {
  DepositCandidate,
  findMercataDeposits,
  findNativeDeposits,
  tokenBalance,
} from "./discovery";

const BPS = 10000n;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Fills already submitted this run, so a tick cannot double-fill. */
const submitted = new Set<string>();

const idOf = (c: DepositCandidate): string =>
  c.kind === "mercata"
    ? `mercata:${c.externalChainId}:${c.externalTxHash}`
    : `native:${c.depositId}`;

interface Decision {
  fill: boolean;
  reason: string;
  expectedFee?: bigint;
  netToPay?: bigint;
  exitFee?: bigint;
}

/**
 * Whether to fill, and on what terms.
 *
 * `expectedFee` is quoted for a moment slightly in the FUTURE. The contract's
 * guard is a floor (`feeCharged >= expectedFee`) and the fee decays every
 * second, so quoting ahead means the real fee at landing is higher than quoted
 * and the guard passes. Quoting the present value would sit exactly on the
 * boundary and fail on any propagation delay at all.
 */
export function decide(
  c: DepositCandidate,
  now: bigint,
  balance: bigint,
  reserve: bigint,
): Decision {
  if (c.amount <= 0n) return { fill: false, reason: "zero amount" };
  if (!c.recipient || !c.token) return { fill: false, reason: "incomplete record" };
  if (c.claimVoided) return { fill: false, reason: "claim already voided" };

  if (c.verification === "announced-only" && !config.policy.fillAnnounced) {
    return { fill: false, reason: "announced only, unverified (SOLVER_FILL_ANNOUNCED=false)" };
  }

  // Price: rung zero pays the schedule, later rungs pay the holder's price.
  let feeAtLanding: bigint;
  if (!c.claimant) {
    feeAtLanding = decayedFee(c.schedule, now + config.policy.quoteLeadSeconds);
  } else {
    if (!c.claimTransferable) {
      return { fill: false, reason: "claim held and not for sale" };
    }
    feeAtLanding = c.claimExitFee ?? 0n;
  }

  if (feeAtLanding <= 0n) return { fill: false, reason: "fee has decayed to zero" };

  const minFee = (c.amount / BPS) * config.policy.minFeeBps;
  if (feeAtLanding < minFee) {
    return {
      fill: false,
      reason: `fee ${feeAtLanding} under the ${config.policy.minFeeBps}bps floor (${minFee})`,
    };
  }

  const netToPay = c.amount - feeAtLanding;
  if (balance - netToPay < reserve) {
    return {
      fill: false,
      reason: `paying ${netToPay} would drop balance ${balance} under reserve ${reserve}`,
    };
  }

  // What the solver asks to be bought out at. Priced off the amount rather than
  // off what it earned, so the offer stays meaningful as the schedule decays.
  const exitFee = config.policy.transferable
    ? (c.amount / BPS) * config.policy.exitFeeBps
    : 0n;

  return { fill: true, reason: "fillable", expectedFee: feeAtLanding, netToPay, exitFee };
}

async function fill(
  client: StratoSolverClient,
  c: DepositCandidate,
  d: Decision,
): Promise<void> {
  const bridge = c.kind === "mercata" ? config.mercataBridge : config.nativeBridge;
  const contractName = c.kind === "mercata" ? "MercataBridge" : "StratoNativeBridge";

  // Approve exactly the net, then fill, in one submission so they share a nonce
  // sequence and cannot be reordered or separated.
  const calls = [
    {
      contractName: "ERC20",
      contractAddress: c.token,
      method: "approve",
      args: { spender: bridge, value: d.netToPay!.toString() },
    },
    c.kind === "mercata"
      ? {
          contractName,
          contractAddress: bridge,
          method: "fillDeposit",
          args: {
            externalChainId: c.externalChainId,
            externalTxHash: c.externalTxHash,
            expectedStratoRecipient: c.recipient,
            expectedStratoToken: c.token,
            expectedStratoTokenAmount: c.amount.toString(),
            expectedFee: d.expectedFee!.toString(),
            transferable: config.policy.transferable,
            exitFee: d.exitFee!.toString(),
          },
        }
      : {
          contractName,
          contractAddress: bridge,
          method: "fillDeposit",
          args: {
            depositId: c.depositId,
            expectedStratoRecipient: c.recipient,
            expectedStratoToken: c.token,
            expectedStratoTokenAmount: c.amount.toString(),
            expectedFee: d.expectedFee!.toString(),
            transferable: config.policy.transferable,
            exitFee: d.exitFee!.toString(),
          },
        },
  ];

  if (config.policy.dryRun) {
    log(`DRY RUN would fill ${idOf(c)}: pay ${d.netToPay} of ${c.token} to ` +
        `${c.recipient}, keep ${d.expectedFee}, resale at ${d.exitFee}`);
    return;
  }

  log(`filling ${idOf(c)}: pay ${d.netToPay}, keep ${d.expectedFee}`);
  const results = await client.call(calls);
  const failed = results.filter((r) => r.status !== "Success");
  if (failed.length) {
    log(`FILL FAILED ${idOf(c)}:`, JSON.stringify(failed));
    return;
  }
  submitted.add(idOf(c));
  log(`filled ${idOf(c)} (${results.map((r) => r.hash).join(", ")})`);
}

async function tick(client: StratoSolverClient, reserves: Record<string, bigint>) {
  const [mercata, native] = await Promise.all([
    findMercataDeposits(client, config.mercataBridge),
    findNativeDeposits(client, config.nativeBridge),
  ]);
  const candidates = [...mercata, ...native].filter((c) => !submitted.has(idOf(c)));
  if (candidates.length === 0) return;

  const now = BigInt(Math.floor(Date.now() / 1000));
  let fills = 0;

  for (const c of candidates) {
    if (fills >= config.policy.maxFillsPerTick) {
      log(`reached maxFillsPerTick (${config.policy.maxFillsPerTick}); rest wait for the next tick`);
      break;
    }

    const tokenKey = c.token.replace(/^0x/, "").toLowerCase();
    const balance = await tokenBalance(client, c.token, client.stratoAddress);
    const decision = decide(c, now, balance, reserves[tokenKey] ?? 0n);

    if (!decision.fill) {
      log(`skip ${idOf(c)} (${c.verification}): ${decision.reason}`);
      continue;
    }

    try {
      await fill(client, c, decision);
      fills++;
    } catch (e) {
      log(`error filling ${idOf(c)}:`, (e as Error).message);
    }
  }
}

async function main() {
  assertConfigured();
  const reserves = loadReserves();
  const client = new StratoSolverClient(config.privateKey, config.strato);

  log(`solver address ${client.address} (strato ${client.stratoAddress})`);
  log(`mode ${config.policy.dryRun ? "DRY RUN" : "LIVE"}, ` +
      `minFee ${config.policy.minFeeBps}bps, quote lead ${config.policy.quoteLeadSeconds}s, ` +
      `announced fills ${config.policy.fillAnnounced ? "ON" : "off"}`);
  log(`watching MercataBridge ${config.mercataBridge} and StratoNativeBridge ${config.nativeBridge}`);

  for (;;) {
    try {
      await tick(client, reserves);
    } catch (e) {
      log("tick failed:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("solver exited:", e);
    process.exit(1);
  });
}
