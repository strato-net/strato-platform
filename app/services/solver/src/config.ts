/**
 * Solver configuration and risk policy.
 *
 * Everything that decides whether the bot risks money is here, not scattered
 * through the execution path, so the answer to "why did it fill that" is one
 * file. The defaults are deliberately timid: a solver that does nothing costs
 * its operator nothing, and a solver that fills something it could not verify
 * can lose the whole amount.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config();
// The helium admin credentials and node URL live here; the solver reads only
// the node URL from it and never the admin passwords.
dotenv.config({ path: path.join(__dirname, "../../../backend/.env") });

const num = (v: string | undefined, d: bigint): bigint =>
  v === undefined || v === "" ? d : BigInt(v);

export interface Policy {
  /**
   * The least fee worth taking, in basis points of the amount.
   *
   * Below this the fee does not cover the risk of the deposit being aborted or
   * the claim being voided, both of which cost the solver the entire net it
   * fronted -- not just the fee.
   */
  minFeeBps: bigint;

  /**
   * How far ahead to quote `expectedFee`.
   *
   * The fee decays every second, and the contract's guard is a FLOOR
   * (`feeCharged >= expectedFee`). So the solver quotes the fee as it will be a
   * little in the future: by the time the transaction lands the real fee is
   * higher than quoted, which passes. Quoting the present value would sit right
   * on the boundary and fail on any propagation delay.
   */
  quoteLeadSeconds: bigint;

  /**
   * Refuse to spend a token below this balance.
   *
   * USDST doubles as gas on STRATO, so draining it does not merely stop fills
   * -- it stops the solver transacting at all, including any recovery action.
   */
  reserve: Record<string, bigint>;

  /**
   * Fill deposits that only exist as a stranger's bonded announcement.
   *
   * OFF by default, and it should stay off unless the operator has independent
   * proof of the origin transaction. An announcement is unverified by
   * construction: if the relayer never confirms it, or confirms different
   * numbers, the claim is void and the solver has paid a stranger for nothing.
   */
  fillAnnounced: boolean;

  /** Whether the solver offers its own claims on for resale, and at what price. */
  transferable: boolean;
  exitFeeBps: bigint;

  /** Stop after this many fills per tick, so one bad config cannot drain a float. */
  maxFillsPerTick: number;

  /** Log intended fills without sending anything. */
  dryRun: boolean;
}

export interface SolverConfig {
  strato: {
    blocUrl: string;
    stratoApiUrl: string;
    cirrusUrl: string;
    gasLimit: number;
    gasPrice: number;
  };
  privateKey: string;
  mercataBridge: string;
  nativeBridge: string;
  pollIntervalMs: number;
  policy: Policy;
}

const nodeUrl = (
  process.env.SOLVER_NODE_URL ||
  // Never default to the app node: it is a follower and was the endpoint that
  // stayed down while the validators were healthy.
  "https://node1.testnet.strato.nexus"
).replace(/\/$/, "");

export const config: SolverConfig = {
  strato: {
    blocUrl: `${nodeUrl}/bloc/v2.2`,
    stratoApiUrl: `${nodeUrl}/strato-api/eth/v1.2`,
    cirrusUrl: `${nodeUrl}/cirrus/search`,
    gasLimit: Number(process.env.SOLVER_GAS_LIMIT || 32_100_000_000),
    gasPrice: Number(process.env.SOLVER_GAS_PRICE || 1),
  },
  privateKey: process.env.SOLVER_PRIVATE_KEY || "",
  mercataBridge: (
    process.env.SOLVER_MERCATA_BRIDGE ||
    "0000000000000000000000000000000000001008"
  ).replace(/^0x/, ""),
  nativeBridge: (
    process.env.SOLVER_NATIVE_BRIDGE ||
    "49f69252b00235030a4dcd4c7ef17a64ef346258"
  ).replace(/^0x/, ""),
  pollIntervalMs: Number(process.env.SOLVER_POLL_MS || 15000),
  policy: {
    minFeeBps: num(process.env.SOLVER_MIN_FEE_BPS, 10n), // 0.10%
    quoteLeadSeconds: num(process.env.SOLVER_QUOTE_LEAD_SECONDS, 120n),
    reserve: {},
    fillAnnounced: process.env.SOLVER_FILL_ANNOUNCED === "true",
    transferable: process.env.SOLVER_TRANSFERABLE !== "false",
    exitFeeBps: num(process.env.SOLVER_EXIT_FEE_BPS, 5n), // 0.05%
    maxFillsPerTick: Number(process.env.SOLVER_MAX_FILLS_PER_TICK || 3),
    dryRun: process.env.SOLVER_DRY_RUN !== "false",
  },
};

/** Per-token floor the solver will not spend below, from SOLVER_RESERVE. */
export function loadReserves(): Record<string, bigint> {
  const raw = process.env.SOLVER_RESERVE || "";
  const out: Record<string, bigint> = {};
  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    const [token, amount] = entry.split(":");
    if (token && amount) out[token.replace(/^0x/, "").toLowerCase()] = BigInt(amount);
  }
  return out;
}

export function assertConfigured(): void {
  if (!config.privateKey) {
    throw new Error(
      "SOLVER_PRIVATE_KEY is not set. The solver signs with a plain secp256k1 " +
        "key and has no OAuth identity; fund that key's address with USDST " +
        "(which is also gas on STRATO) plus whatever tokens it should fill.",
    );
  }
}
