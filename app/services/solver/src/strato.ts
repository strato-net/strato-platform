/**
 * STRATO access for a self-custody solver.
 *
 * The solver holds a plain secp256k1 key and no OAuth identity, so it cannot
 * use the relayer's `execute` path. STRATO's self-custody route instead has the
 * node build the transaction and the holder sign an EIP-712 hash of it:
 *
 *   1. POST {bloc}/transaction/unsigned  -> unsigned tx(s) with nonce + gasLimit
 *   2. sign the EIP-712 Transaction hash with the key
 *   3. POST {stratoApi}/transaction      -> tx hash
 *   4. POST {bloc}/transactions/results  -> poll to resolution
 *
 * Ported from strato-wallet/src/core/tx-strato.ts, which is the reference for
 * this flow. Three details are load-bearing and easy to get silently wrong:
 *
 *   - The EIP-712 `network` field is the literal string "STRATO", NOT the
 *     node's own network name. Signing the echoed value produces a valid
 *     signature for the wrong message and the node rejects it as unauthorised.
 *   - r and s go up as 64 hex characters with no 0x, and v as the one-byte
 *     recovery + 27. Anything else fails signature recovery rather than
 *     erroring usefully.
 *   - Every route needs an `X-Wallet-Address` header, or nginx's csrf.lua
 *     answers 403 "Authentication required" before the node ever sees it.
 *
 * USDST IS THE GAS TOKEN on STRATO -- there is no native balance -- so a solver
 * that runs out of USDST stops being able to transact at all, not merely to
 * fill. {gasBalance} exists to make that visible before it happens.
 */
import { Wallet, Signature, TypedDataEncoder, getAddress } from "ethers";

export interface StratoConfig {
  blocUrl: string;
  stratoApiUrl: string;
  cirrusUrl: string;
  chainId?: string;
  gasLimit: number;
  gasPrice: number;
}

/** The node's own EIP-712 type for a self-custody transaction. */
const STRATO_TYPED_DATA = {
  domain: { name: "STRATO", version: "1" },
  types: {
    Transaction: [
      { name: "to", type: "address" },
      { name: "funcName", type: "string" },
      { name: "args", type: "string[]" },
      { name: "nonce", type: "uint256" },
      { name: "gasLimit", type: "uint256" },
      { name: "network", type: "string" },
    ],
  },
  primaryType: "Transaction",
} as const;

/** Literal, not the node's network name. See the note above. */
const SIGNING_NETWORK = "STRATO";

interface UnsignedTx {
  hash?: string;
  data: {
    nonce: number | string;
    gasLimit: number | string;
    to: string;
    functionName?: string;
    args?: string[];
    network?: string;
  };
}

export interface CallRequest {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, unknown>;
}

export interface TxOutcome {
  hash: string;
  status: string;
  message?: string;
}

export class StratoSolverClient {
  private readonly wallet: Wallet;
  readonly address: string;

  constructor(privateKey: string, private readonly cfg: StratoConfig) {
    this.wallet = new Wallet(
      privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
    );
    this.address = this.wallet.address;
  }

  /** STRATO renders addresses lower-case and unprefixed. */
  get stratoAddress(): string {
    return this.address.replace(/^0x/, "").toLowerCase();
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      // Without this, nginx's csrf.lua rejects the request before the node
      // sees it -- and the 403 says "Authentication required", which reads
      // like a credentials problem rather than a missing header.
      "X-Wallet-Address": this.stratoAddress,
    };
  }

  private chainQuery(): string {
    return this.cfg.chainId ? `?chainid=${this.cfg.chainId}` : "";
  }

  /** Read contract state, mappings included. Absent fields are zero/false. */
  async readState(contractName: string, address: string): Promise<any> {
    const url = `${this.cfg.blocUrl}/contracts/${contractName}/${address.replace(/^0x/, "")}/state`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`state read failed (${res.status}): ${url}`);
    return res.json();
  }

  /** Cirrus query. Returns [] on any failure: discovery must not throw. */
  async cirrus(path: string, params: Record<string, string> = {}): Promise<any[]> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.cfg.cirrusUrl}/${path}${qs ? `?${qs}` : ""}`;
    try {
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) return [];
      const data = (await res.json()) as any;
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Submit one or more contract calls as this key, and wait for resolution.
   *
   * Calls in a single invocation share a nonce sequence assigned by the node,
   * so an approve and the fill that depends on it can go together and cannot
   * be reordered.
   */
  async call(requests: CallRequest[]): Promise<TxOutcome[]> {
    if (requests.length === 0) return [];

    const unsigned = await this.fetchUnsigned(requests);
    if (unsigned.length !== requests.length) {
      throw new Error(
        `node returned ${unsigned.length} unsigned txs for ${requests.length} calls`,
      );
    }

    // THE NODE ASSIGNS THE SAME NONCE TO EVERY TX IN A BUNDLE, so a bundle has
    // to be renumbered sequentially before signing or every tx after the first
    // is rejected for a stale nonce -- and the first can be rejected too, as
    // "a more lucrative transaction" wins the collision. Single-tx bundles are
    // unaffected (i = 0). The nonce is inside the signed EIP-712 message, so
    // this must happen BEFORE signing, not at submission.
    const base = BigInt(unsigned[0]?.data?.nonce ?? 0);
    const hashes: string[] = [];
    for (let i = 0; i < unsigned.length; i++) {
      unsigned[i].data.nonce = (base + BigInt(i)).toString();
      hashes.push(await this.signAndSubmit(unsigned[i]));
    }
    return this.pollResults(hashes);
  }

  private async fetchUnsigned(requests: CallRequest[]): Promise<UnsignedTx[]> {
    const body = {
      txs: requests.map((r) => ({
        type: "FUNCTION",
        payload: {
          contractName: r.contractName,
          contractAddress: r.contractAddress.replace(/^0x/, ""),
          method: r.method,
          args: r.args,
        },
      })),
      address: this.stratoAddress,
      txParams: { gasLimit: this.cfg.gasLimit, gasPrice: this.cfg.gasPrice },
    };

    const res = await fetch(
      `${this.cfg.blocUrl}/transaction/unsigned${this.chainQuery()}`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
    );
    if (!res.ok) {
      throw new Error(`unsigned tx request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?._unsignedTxs)) return data._unsignedTxs;
    if (Array.isArray(data?.txs)) return data.txs;
    return [];
  }

  private async signAndSubmit(tx: UnsignedTx): Promise<string> {
    const d = tx.data;
    // ethers v6 exposes the EIP-712 digest via TypedDataEncoder, not a
    // top-level helper.
    const digest = TypedDataEncoder.hash(
      STRATO_TYPED_DATA.domain,
      STRATO_TYPED_DATA.types as any,
      {
        to: getAddress(`0x${d.to.replace(/^0x/, "")}`),
        funcName: d.functionName ?? "",
        args: d.args ?? [],
        nonce: BigInt(d.nonce),
        gasLimit: BigInt(d.gasLimit),
        network: SIGNING_NETWORK,
      },
    );

    const sig = Signature.from(this.wallet.signingKey.sign(digest));
    const signed = {
      nonce: Number(d.nonce),
      gasLimit: d.gasLimit,
      to: d.to,
      funcName: d.functionName,
      args: d.args,
      network: SIGNING_NETWORK,
      r: sig.r.replace(/^0x/, "").padStart(64, "0"),
      s: sig.s.replace(/^0x/, "").padStart(64, "0"),
      v: (sig.yParity + 27).toString(16).padStart(2, "0"),
      txVersion: 1,
    };

    const res = await fetch(
      `${this.cfg.stratoApiUrl}/transaction${this.chainQuery()}`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(signed) },
    );
    if (!res.ok) {
      throw new Error(`submit failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    const hash = typeof data === "string" ? data : (data?.hash ?? tx.hash);
    if (!hash) throw new Error(`submit returned no hash: ${JSON.stringify(data)}`);
    return hash;
  }

  private async pollResults(
    hashes: string[],
    timeoutMs = 120_000,
    intervalMs = 3000,
  ): Promise<TxOutcome[]> {
    const start = Date.now();
    for (;;) {
      const res = await fetch(`${this.cfg.blocUrl}/transactions/results`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(hashes),
      });
      const list: any[] = res.ok
        ? ((await res.json().catch(() => [])) as any[])
        : [];
      if (list.length && list.every((r) => r?.status && r.status !== "Pending")) {
        return list.map((r) => ({
          hash: r.hash,
          status: r.status,
          message: r?.txResult?.message ?? r?.message,
        }));
      }
      if (Date.now() - start >= timeoutMs) {
        return hashes.map((hash) => ({ hash, status: "Timeout" }));
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
