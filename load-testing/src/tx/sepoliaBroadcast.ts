/**
 * Sepolia (or any EVM testnet) broadcaster for the canonical UI bridge-in
 * flow used by Scenario 1 (`tokenSale`):
 *
 *   1. Sign Permit2 typed-data (EIP-712) for an ERC20 (e.g. Sepolia USDC).
 *   2. Submit `DepositRouter.deposit(token, amount, stratoAddress,
 *      targetStratoToken, nonce, deadline, signature)` on Sepolia.
 *
 * The bridge service (mercata/services/bridge) detects the `DepositRouted`
 * event, mints the corresponding STRATO-side token (USDST) to the recipient
 * and — when the per-deposit AUTO_FORGE action is queued via
 * /api/bridge/requestDepositAction — auto-forges the metal (e.g. GOLDST)
 * server-side.
 *
 * Concurrency model: a single signer (one EOA) issues sequential nonces
 * (`startNonce + i`) for the i-th iteration. ethers' provider only fires
 * `eth_sendRawTransaction` per call (we pre-supply nonce/gas overrides), so
 * the broadcasts can fan out cleanly without provider-side serialisation.
 *
 * On `init()`, if the EOA has not yet approved Permit2 to spend the
 * configured ERC20 for max-uint256, a one-time `approve(MAX)` is submitted
 * and awaited. After that every iteration only signs typed-data and calls
 * `DepositRouter.deposit(...)`.
 *
 * Minimal ABI for the Mercata DepositRouter contract — see
 * mercata/ethereum/contracts/bridge/DepositRouter.sol.
 *
 * DepositRouted event signature (topic0):
 *   0x55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750
 */
const DEPOSIT_ROUTER_ABI = [
  "function deposit(address token, uint256 amount, address stratoAddress, address targetStratoToken, uint256 nonce, uint256 deadline, bytes calldata signature) external",
  "function PERMIT2() view returns (address)",
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
];

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/** Topic0 of DepositRouted (keccak256 of the canonical event signature). */
const DEPOSIT_ROUTED_TOPIC0 =
  "0x55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750";

/** Canonical Permit2 deployment used on every chain where Uniswap deployed it. */
const CANONICAL_PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** Max uint256 — used for blanket Permit2 allowance from the EOA. */
const MAX_UINT256 =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

export function normalizeAddress0x(addr: string): string {
  const hex = addr.replace(/^0x/i, "").toLowerCase();
  if (hex.length !== 40) {
    throw new Error(`Expected 40-hex-char address, got: ${addr}`);
  }
  return `0x${hex}`;
}

export interface SepoliaBroadcasterConfig {
  rpcUrl: string;
  privateKey: string;
  depositRouterAddress: string;
  /** ERC20 token contract on the external chain (e.g. Sepolia USDC at
   *  `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`). */
  tokenAddress: string;
  /** Permit2 contract address. Default canonical
   *  `0x000000000022D473030F116dDEE9F6B43aC78BA3`. */
  permit2Address?: string;
  chainId?: number; // default 11155111
  gasLimit?: number;
  maxFeePerGasGwei?: number;
  maxPriorityFeePerGasGwei?: number;
  /** Override the starting nonce. If omitted, queried from chain. */
  startNonce?: number;
  /** Max ms to wait for a Sepolia tx receipt before marking as failed.
   *  Default 120000 (2 min). Prevents indefinite hang if a tx gets stuck. */
  waitTimeoutMs?: number;
}

export interface BroadcastDepositResult {
  txHash: string;
  submitDurationMs: number;
  confirmDurationMs: number;
  /** Final outcome — "submitted" if not awaiting confirmation. */
  status: "submitted" | "confirmed" | "failed";
  error?: string;
}

export interface ReceiptInspection {
  /**
   *  - "confirmed": tx mined with status=1
   *  - "reverted":  tx mined with status=0
   *  - "pending":   tx exists in mempool / not yet mined within the timeout
   *  - "not_found": getTransactionReceipt + getTransaction both returned null
   */
  status: "confirmed" | "reverted" | "pending" | "not_found";
  blockNumber?: number;
  gasUsed?: string;
  /** Number of `DepositRouted` topic0 entries in the receipt logs. Bridge
   *  service requires ≥ 1 of these per tx to register a deposit. */
  depositRoutedCount: number;
  /** When status="reverted", the EVM revert reason as best as ethers can
   *  reconstruct it (via a replay `provider.call`). May be absent. */
  errorReason?: string;
}

/**
 * One initialised broadcaster, reusable across iterations. Init once, then
 * call `broadcastDepositERC20` repeatedly with sequential `nonceOffset`
 * values.
 */
export class SepoliaBroadcaster {
  private cfg: SepoliaBroadcasterConfig;
  private ethers: any = null;
  private provider: any = null;
  private wallet: any = null;
  private router: any = null;
  private startNonce_: number = 0;
  private maxFeePerGas_: bigint = 0n;
  private maxPriorityFeePerGas_: bigint = 0n;
  private gasLimit_: bigint = 250000n;
  private chainId_: number;
  /** Permit2 contract address. Populated during init(). */
  private permit2Address_: string = "";
  /** ERC20 contract handle for the configured ERC20 token. */
  private erc20: any = null;
  /** Permit2 nonce counter — initialised to a unique high-bit value at init
   *  so concurrent runs against the same EOA don't collide. */
  private permitNonceBase_: bigint = 0n;

  constructor(cfg: SepoliaBroadcasterConfig) {
    this.cfg = cfg;
    this.chainId_ = cfg.chainId ?? 11155111;
  }

  async init(): Promise<void> {
    try {
      this.ethers = require("ethers");
    } catch {
      throw new Error(
        "Sepolia broadcaster: 'ethers' is not installed. Run `npm install` in load-testing/.",
      );
    }

    this.provider = new this.ethers.JsonRpcProvider(this.cfg.rpcUrl, this.chainId_);
    this.wallet = new this.ethers.Wallet(this.cfg.privateKey, this.provider);
    this.router = new this.ethers.Contract(
      this.cfg.depositRouterAddress,
      DEPOSIT_ROUTER_ABI,
      this.wallet,
    );

    this.startNonce_ =
      this.cfg.startNonce !== undefined
        ? this.cfg.startNonce
        : await this.provider.getTransactionCount(this.wallet.address, "pending");

    const feeData = await this.provider.getFeeData();
    this.maxFeePerGas_ =
      this.cfg.maxFeePerGasGwei !== undefined
        ? this.ethers.parseUnits(String(this.cfg.maxFeePerGasGwei), "gwei")
        : feeData.maxFeePerGas ?? this.ethers.parseUnits("30", "gwei");
    this.maxPriorityFeePerGas_ =
      this.cfg.maxPriorityFeePerGasGwei !== undefined
        ? this.ethers.parseUnits(String(this.cfg.maxPriorityFeePerGasGwei), "gwei")
        : feeData.maxPriorityFeePerGas ?? this.ethers.parseUnits("2", "gwei");
    this.gasLimit_ = BigInt(this.cfg.gasLimit ?? 250000);

    await this.initErc20Setup();
  }

  /**
   * Resolve the Permit2 address and ensure the EOA has approved Permit2 to
   * spend the configured ERC20 for max-uint256. The DepositRouter contract's
   * `PERMIT2()` getter is preferred over the canonical address to handle
   * non-standard deployments.
   */
  private async initErc20Setup(): Promise<void> {
    const tokenAddress = this.ethers.getAddress(this.cfg.tokenAddress);

    let permit2 = this.cfg.permit2Address;
    if (!permit2) {
      try {
        permit2 = await this.router.PERMIT2();
      } catch {
        // Older DepositRouter deployments may not expose PERMIT2() — fall
        // back to canonical address.
        permit2 = CANONICAL_PERMIT2_ADDRESS;
      }
    }
    this.permit2Address_ = this.ethers.getAddress(permit2!);

    this.erc20 = new this.ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);

    // One-time blanket allowance: if EOA hasn't approved Permit2 for max,
    // submit an approve tx now and wait for confirmation.
    const allowance: bigint = await this.erc20.allowance(
      this.wallet.address,
      this.permit2Address_,
    );
    const minRequired = BigInt(MAX_UINT256) >> 1n; // half max — re-approve below this
    if (allowance < minRequired) {
      console.log(
        `[sepoliaBroadcast] EOA ${this.wallet.address} has insufficient ` +
          `Permit2 allowance for ${tokenAddress} (${allowance.toString()}). ` +
          `Submitting one-time approve(MAX_UINT256)...`,
      );
      const approveTx = await this.erc20.approve(this.permit2Address_, MAX_UINT256, {
        gasLimit: this.gasLimit_,
        maxFeePerGas: this.maxFeePerGas_,
        maxPriorityFeePerGas: this.maxPriorityFeePerGas_,
      });
      // The approve consumes nonce slot startNonce_; bump our base for
      // subsequent deposit broadcasts so we don't double-use it.
      this.startNonce_ += 1;
      const waitTimeoutMs = this.cfg.waitTimeoutMs ?? 120000;
      await Promise.race([
        approveTx.wait(),
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`approve tx timed out after ${waitTimeoutMs}ms`)),
            waitTimeoutMs,
          ),
        ),
      ]);
      console.log(`[sepoliaBroadcast] Permit2 approval confirmed: ${approveTx.hash}`);
    }

    // Permit2 nonces are arbitrary uint256 values; use a per-init randomised
    // high-bit base so concurrent runs and historical runs don't collide.
    // Combine 64 bits of timestamp + 32 bits of crypto-random + iteration i.
    const tsHigh = BigInt(Math.floor(Date.now() / 1000)) << 96n;
    const rand =
      (BigInt("0x" +
        Buffer.from(this.ethers.randomBytes(4)).toString("hex")
      ) << 64n);
    this.permitNonceBase_ = tsHigh | rand;
  }

  get walletAddress(): string {
    return this.wallet.address;
  }

  get startNonce(): number {
    return this.startNonce_;
  }

  get maxFeePerGas(): bigint {
    return this.maxFeePerGas_;
  }

  get maxPriorityFeePerGas(): bigint {
    return this.maxPriorityFeePerGas_;
  }

  get gasLimit(): bigint {
    return this.gasLimit_;
  }

  /**
   * Sign + broadcast `DepositRouter.deposit(token, amount, stratoAddress,
   * targetStratoToken, nonce, deadline, signature)` on Sepolia.
   *
   * Mirrors the Mercata UI's bridge-in code path for ERC20 deposits:
   *   1. Build Permit2 `PermitTransferFrom` typed-data with spender = the
   *      DepositRouter address (DepositRouter is what calls
   *      `permit2.permitTransferFrom`).
   *   2. Sign with the EOA's key (EIP-712 typed-data via ethers v6 native
   *      `Wallet.signTypedData`).
   *   3. Submit `DepositRouter.deposit(...)` carrying the signature.
   */
  async broadcastDepositERC20(args: {
    nonceOffset: number;
    stratoRecipient: string; // 0x-prefixed
    targetStratoToken: string; // 0x-prefixed
    amountWei: string;
    awaitConfirmation: boolean;
    /** Optional override for the Permit2 deadline window (seconds from now). */
    permitDeadlineSec?: number;
  }): Promise<BroadcastDepositResult> {
    const submitStart = Date.now();
    let txHash = `sepoliaDepositERC20:${args.nonceOffset}`;
    let submitDurationMs = 0;
    let confirmDurationMs = 0;
    let status: BroadcastDepositResult["status"] = "submitted";
    let error: string | undefined;

    try {
      const tokenAddress = this.ethers.getAddress(this.cfg.tokenAddress);
      const amount = BigInt(args.amountWei);
      const permitDeadlineSec = args.permitDeadlineSec ?? 1800;
      const deadline =
        BigInt(Math.floor(Date.now() / 1000)) + BigInt(permitDeadlineSec);
      // Per-iteration Permit2 nonce: high-bit randomised base + i. Permit2
      // tracks consumed nonces in a bitmap so any unused value is valid.
      const permitNonce = this.permitNonceBase_ + BigInt(args.nonceOffset);

      // EIP-712 typed-data Permit2 expects for `permitTransferFrom`. The
      // `spender` is the DepositRouter (which is what calls Permit2 inside
      // `deposit(...)`). Field ordering matches Permit2's source TYPEHASH.
      const domain = {
        name: "Permit2",
        chainId: this.chainId_,
        verifyingContract: this.permit2Address_,
      };
      const types = {
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        permitted: { token: tokenAddress, amount },
        spender: this.ethers.getAddress(this.cfg.depositRouterAddress),
        nonce: permitNonce,
        deadline,
      };

      const signature: string = await this.wallet.signTypedData(
        domain,
        types,
        value,
      );

      const overrides: any = {
        nonce: this.startNonce_ + args.nonceOffset,
        gasLimit: this.gasLimit_,
        maxFeePerGas: this.maxFeePerGas_,
        maxPriorityFeePerGas: this.maxPriorityFeePerGas_,
      };
      const tx = await this.router.deposit(
        tokenAddress,
        amount,
        args.stratoRecipient,
        args.targetStratoToken,
        permitNonce,
        deadline,
        signature,
        overrides,
      );
      txHash = tx.hash;
      submitDurationMs = Date.now() - submitStart;

      if (args.awaitConfirmation) {
        const confirmStart = Date.now();
        // Race tx.wait() against a hard timeout. ethers' tx.wait() has no
        // built-in timeout in v6 — without this, a stuck mempool tx would
        // hang the entire load-test run forever.
        const waitTimeoutMs = this.cfg.waitTimeoutMs ?? 120000;
        const receipt: any = await Promise.race([
          tx.wait(),
          new Promise((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `tx.wait timed out after ${waitTimeoutMs}ms (hash=${txHash})`,
                  ),
                ),
              waitTimeoutMs,
            ),
          ),
        ]);
        confirmDurationMs = Date.now() - confirmStart;
        if (receipt && receipt.status === 1) {
          status = "confirmed";
        } else {
          status = "failed";
          error = `Sepolia receipt status=${receipt?.status}`;
        }
      }
    } catch (err: any) {
      submitDurationMs = Date.now() - submitStart;
      status = "failed";
      error = err.shortMessage || err.reason || err.message || String(err);
    }

    return { txHash, submitDurationMs, confirmDurationMs, status, error };
  }

  /**
   * Read the EOA's native (Sepolia ETH) balance and its ERC20 (USDC) balance.
   * Used as a startup sanity check — if either is too low to fund N deposits,
   * the test will broadcast txs that revert immediately on insufficient
   * balance, and the user gets a clear early signal instead of a vague
   * "AUTO_FORGE TIMEOUT 5 minutes later".
   */
  async getEoaBalances(): Promise<{ ethWei: bigint; tokenUnits: bigint | null }> {
    const ethWei: bigint = await this.provider.getBalance(this.wallet.address);
    let tokenUnits: bigint | null = null;
    try {
      tokenUnits = (await this.erc20.balanceOf(this.wallet.address)) as bigint;
    } catch {
      tokenUnits = null;
    }
    return { ethWei, tokenUnits };
  }

  /**
   * Inspect a previously-broadcast tx hash on Sepolia to find out what
   * actually happened on-chain. Polls `getTransactionReceipt` until the tx
   * either lands (status 0 or 1) or `timeoutMs` elapses.
   *
   * On `status: "reverted"` we replay the tx via `provider.call` at the same
   * block to extract the revert reason — this works for explicit `require`s
   * (e.g. "ERC20: insufficient balance") but not for assembly `revert(0,0)`.
   */
  async inspectReceipt(
    txHash: string,
    opts?: { timeoutMs?: number; pollMs?: number },
  ): Promise<ReceiptInspection> {
    const timeoutMs = opts?.timeoutMs ?? 60000;
    const pollMs = opts?.pollMs ?? 3000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let receipt: any = null;
      try {
        receipt = await this.provider.getTransactionReceipt(txHash);
      } catch {
        // transient RPC error — keep polling
      }
      if (receipt) {
        const drCount = (receipt.logs ?? []).filter(
          (l: any) =>
            (l.topics?.[0] ?? "").toLowerCase() === DEPOSIT_ROUTED_TOPIC0.toLowerCase(),
        ).length;
        const status = receipt.status === 1 ? "confirmed" : "reverted";
        let errorReason: string | undefined;
        if (status === "reverted") {
          try {
            const tx = await this.provider.getTransaction(txHash);
            if (tx) {
              try {
                await this.provider.call({
                  from: tx.from,
                  to: tx.to,
                  data: tx.data,
                  value: tx.value,
                  blockTag: receipt.blockNumber,
                });
              } catch (callErr: any) {
                errorReason =
                  callErr?.shortMessage ||
                  callErr?.reason ||
                  callErr?.info?.error?.message ||
                  callErr?.message;
              }
            }
          } catch {
            // best-effort only
          }
        }
        return {
          status,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed?.toString(),
          depositRoutedCount: drCount,
          errorReason,
        };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    // No receipt within timeout — distinguish "tx exists but unmined" from
    // "tx wasn't accepted into the mempool / wrong hash".
    let txExists = false;
    try {
      const tx = await this.provider.getTransaction(txHash);
      txExists = tx != null;
    } catch {
      txExists = false;
    }
    return {
      status: txExists ? "pending" : "not_found",
      depositRoutedCount: 0,
    };
  }
}
